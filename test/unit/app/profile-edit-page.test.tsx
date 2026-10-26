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
vi.mock('@/app/profile/[displayId]/edit/actions', () => ({
  updateProfileAction: {
    bind: (_this: unknown, targetId: unknown) => {
      boundary.boundTo.push(targetId);
      return vi.fn();
    },
  },
}));

const { default: EditProfilePage, metadata } = await import('@/app/profile/[displayId]/edit/page');

let accounts: ReturnType<typeof createTestDependencies>;

function page(displayId: string) {
  return EditProfilePage({ params: Promise.resolve({ displayId }) });
}

beforeEach(async () => {
  accounts = createTestDependencies();
  await createAccount(accounts.deps, { ...validInput, bio: '自己紹介' }); // FIXED_ID: Alice_1
  boundary.deps = accounts.deps;
  boundary.session = { user: { id: FIXED_ID }, expires: '2099-01-01T00:00:00Z' };
  boundary.boundTo.length = 0;
});

describe('EditProfilePage', () => {
  it('本人なら現在の値でフォームを表示し、対象UUIDをActionにbindする', async () => {
    render(await page('Alice_1'));

    expect(screen.getByLabelText('名前')).toHaveValue('アリス');
    expect(screen.getByLabelText('ユーザーID')).toHaveValue('Alice_1');
    expect(screen.getByLabelText('自己紹介')).toHaveValue('自己紹介');
    expect(screen.getByRole('link', { name: '編集をキャンセル' })).toHaveAttribute('href', '/profile/Alice_1');
    expect(boundary.boundTo).toEqual([FIXED_ID]);
    expect(metadata).toMatchObject({ title: 'プロフィール編集' });
  });

  it('URLのIDの大小文字が違っても本人なら表示する', async () => {
    render(await page('ALICE_1'));

    expect(screen.getByLabelText('ユーザーID')).toHaveValue('Alice_1');
  });

  it('未ログインなら /login へredirectする', async () => {
    boundary.session = null;

    await expect(page('Alice_1')).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('セッションだけ残り利用者がいなければ /login へredirectする', async () => {
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

  it('利用者の確認に失敗したら未ログインと混同せず、再試行を表示する', async () => {
    vi.spyOn(accounts.users, 'findById').mockRejectedValue(new Error('db down: secret-host'));

    render(await page('Alice_1'));

    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret-host');
    expect(screen.queryByLabelText('名前')).not.toBeInTheDocument();
  });
});
