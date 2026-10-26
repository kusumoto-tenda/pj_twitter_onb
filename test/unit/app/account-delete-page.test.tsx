import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';

const boundary = vi.hoisted(() => ({
  session: null as unknown,
  deps: undefined as unknown,
  boundTo: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// ページの振る舞いのテストなので、投稿ボタン（ルートlayoutのProviderが必要）は空にする。
vi.mock('@/app/ui/tweets/create-tweet-launcher', () => ({ CreateTweetLauncher: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/app/_composition/account', () => ({ getAccountDependencies: () => boundary.deps }));
vi.mock('@/app/profile/[displayId]/delete/actions', () => ({
  deleteAccountAction: {
    bind: (_this: unknown, targetId: unknown) => {
      boundary.boundTo.push(targetId);
      return vi.fn();
    },
  },
}));

const { default: DeleteAccountPage, metadata } = await import('@/app/profile/[displayId]/delete/page');

let accounts: ReturnType<typeof createTestDependencies>;

function page(displayId: string) {
  return DeleteAccountPage({ params: Promise.resolve({ displayId }) });
}

beforeEach(async () => {
  accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput); // FIXED_ID: Alice_1
  boundary.deps = accounts.deps;
  boundary.session = { user: { id: FIXED_ID }, expires: '2099-01-01T00:00:00Z' };
  boundary.boundTo.length = 0;
});

describe('DeleteAccountPage', () => {
  it('本人なら確認フォームを表示し、対象UUIDをbindするだけで削除しない', async () => {
    const remove = vi.spyOn(accounts.users, 'deleteById');

    render(await page('Alice_1'));

    expect(screen.getByRole('heading', { name: 'パスワードを確認' })).toBeInTheDocument();
    expect(screen.getByText('@Alice_1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '戻る' })).toHaveAttribute('href', '/profile/Alice_1');
    expect(boundary.boundTo).toEqual([FIXED_ID]);
    expect(remove).not.toHaveBeenCalled();
    expect(metadata).toMatchObject({ title: 'アカウント削除' });
  });

  it('URLのIDの大小文字が違っても本人なら表示する', async () => {
    render(await page('ALICE_1'));

    expect(screen.getByRole('heading', { name: 'パスワードを確認' })).toBeInTheDocument();
  });

  it('未ログイン、またはセッションだけ残った利用者は /login へredirectする', async () => {
    boundary.session = null;
    await expect(page('Alice_1')).rejects.toThrow('NEXT_REDIRECT:/login');

    boundary.session = { user: { id: '00000000-0000-4000-8000-00000000dead' }, expires: '2099-01-01' };
    await expect(page('Alice_1')).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it.each([
    ['他人のID', 'Bob_12'],
    ['変更前の古いID', 'Alice_0'],
    ['形式違反のID', '@bad'],
  ])('%sなら見つからない表示にする', async (_label, displayId) => {
    await expect(page(displayId)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(boundary.boundTo).toEqual([]);
  });

  it('利用者の確認に失敗したら、ログインや404にせず再試行を表示する', async () => {
    vi.spyOn(accounts.users, 'findById').mockRejectedValue(new Error('db down: secret-host'));

    render(await page('Alice_1'));

    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret-host');
    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  });
});
