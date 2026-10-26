import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';

const boundary = vi.hoisted(() => ({
  session: null as unknown,
  deps: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/app/_composition/account', () => ({
  getAccountDependencies: () => boundary.deps,
}));
vi.mock('@/app/login/actions', () => ({ loginAction: vi.fn() }));

const { default: LoginPage, metadata } = await import('@/app/login/page');

async function renderPage() {
  render(await LoginPage());
}

let context: ReturnType<typeof createTestDependencies>;

beforeEach(async () => {
  context = createTestDependencies();
  boundary.deps = context.deps;
  boundary.session = null;
  await createAccount(context.deps, validInput);
});

describe('LoginPage', () => {
  it('セッションがなければ見出し・フォーム・ロゴを表示する', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: 'すべての話題が、ここに。' })).toBeInTheDocument();
    expect(screen.getByLabelText('ユーザーID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
    expect(screen.getByTestId('x-logo')).toBeInTheDocument();
    expect(metadata).toMatchObject({ title: 'ログイン' });
  });

  it('有効なセッションでDBにも利用者がいれば / へredirectする', async () => {
    boundary.session = { user: { id: FIXED_ID }, expires: '2099-01-01T00:00:00Z' };

    await expect(LoginPage()).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('セッションにUUIDがなければフォームを表示する', async () => {
    boundary.session = { user: {}, expires: '2099-01-01T00:00:00Z' };

    await renderPage();

    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('セッションのUUIDに対応する利用者がDBにいなければフォームを表示する', async () => {
    boundary.session = {
      user: { id: '00000000-0000-4000-8000-00000000dead' },
      expires: '2099-01-01T00:00:00Z',
    };

    await renderPage();

    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('利用者の確認でDB障害が起きてもフォームを表示し、エラー内容を出さない', async () => {
    boundary.session = { user: { id: FIXED_ID }, expires: '2099-01-01T00:00:00Z' };
    vi.spyOn(context.users, 'findById').mockRejectedValue(new Error('db down: secret-host'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await renderPage();

    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret-host');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('アカウント削除後の通知を表示する', async () => {
    document.cookie = 'flash_account=deleted; path=/';

    await renderPage();

    expect(await screen.findByRole('status')).toHaveTextContent('アカウントを削除しました');
  });

  it('ログアウト後の通知を一度表示する', async () => {
    document.cookie = 'flash_session=logged-out; path=/';

    await renderPage();

    expect(await screen.findByRole('status')).toHaveTextContent('ログアウトしました');
    expect(document.cookie).not.toContain('flash_session=');
  });
});
