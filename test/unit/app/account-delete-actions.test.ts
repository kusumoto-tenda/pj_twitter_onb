import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import type { FakePasswordHasher } from '@/test/support/fake-password-hasher';
import type { InMemoryUserRepository } from '@/test/support/in-memory-user-repository';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';

const boundary = vi.hoisted(() => ({
  calls: [] as string[],
  cookieSet: vi.fn(),
  session: null as unknown,
  deps: undefined as unknown,
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    boundary.calls.push(`redirect:${url}`);
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string, type?: string) => {
    boundary.calls.push(`revalidate:${path}${type ? `:${type}` : ''}`);
  }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: (...args: unknown[]) => {
      boundary.calls.push(`cookie:${String(args[0])}=${String(args[1])}`);
      boundary.cookieSet(...args);
    },
  })),
}));
vi.mock('@/app/_auth/auth', () => ({
  auth: vi.fn(async () => {
    boundary.calls.push('auth');
    return boundary.session;
  }),
  signOut: (...args: unknown[]) => {
    boundary.calls.push('signOut');
    return boundary.signOut(...args);
  },
}));
vi.mock('@/app/_composition/account', () => ({ getAccountDependencies: () => boundary.deps }));

const { deleteAccountAction } = await import('@/app/profile/[displayId]/delete/actions');
const { initialAccountDeleteState } = await import('@/app/profile/[displayId]/delete/form-state');
const { ACCOUNT_DELETED_COOKIE, FLASH_COOKIE, PROFILE_UPDATED_COOKIE } = await import(
  '@/app/ui/notifications/flash'
);

const REVALIDATIONS = [
  'revalidate:/',
  'revalidate:/profile/[displayId]:page',
  'revalidate:/profile/[displayId]/edit:page',
  'revalidate:/profile/[displayId]/delete:page',
  'revalidate:/favorites',
];

function form(fields: Record<string, string | string[] | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

let users: InMemoryUserRepository;
let passwords: FakePasswordHasher;

function signIn(id: string | null) {
  boundary.session = id ? { user: { id }, expires: '2099-01-01T00:00:00Z' } : null;
}

beforeEach(async () => {
  boundary.calls.length = 0;
  boundary.cookieSet.mockReset();
  boundary.signOut.mockReset().mockResolvedValue({ redirect: 'http://localhost:3000/', cookies: [] });
  const context = createTestDependencies();
  await createAccount(context.deps, validInput); // FIXED_ID
  await createAccount(context.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  users = context.users;
  passwords = context.passwords;
  boundary.deps = context.deps;
  signIn(FIXED_ID);
});

describe('deleteAccountAction', () => {
  it('成功時はキャッシュ無効化→signOut→削除通知Cookie→/loginの順に行う', async () => {
    await expect(
      deleteAccountAction(FIXED_ID, initialAccountDeleteState, form({ password: 'password123' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(users.accounts.map((a) => a.id)).toEqual([OTHER_ID]);
    expect(boundary.calls).toEqual([
      'auth',
      ...REVALIDATIONS,
      'signOut',
      `cookie:${ACCOUNT_DELETED_COOKIE}=deleted`,
      'redirect:/login',
    ]);
    expect(boundary.signOut).toHaveBeenCalledWith({ redirect: false });
    expect([FLASH_COOKIE, PROFILE_UPDATED_COOKIE]).not.toContain(ACCOUNT_DELETED_COOKIE);
    expect(boundary.cookieSet).toHaveBeenCalledWith(
      ACCOUNT_DELETED_COOKIE,
      'deleted',
      expect.objectContaining({ path: '/', sameSite: 'lax', httpOnly: false }),
    );
  });

  it('呼ぶたびにセッションを確認し、別アカウントへ切り替わった古いフォームでは誰も削除・ログアウトしない', async () => {
    signIn(OTHER_ID);

    const state = await deleteAccountAction(
      FIXED_ID,
      initialAccountDeleteState,
      form({ password: 'password123' }),
    );

    expect(state).toMatchObject({
      status: 'error',
      code: 'FORBIDDEN',
      message: 'このアカウントは削除できません',
    });
    expect(users.accounts).toHaveLength(2);
    expect(boundary.calls).toEqual(['auth']);
  });

  it('改変したpreviousStateやhidden値でも本人確認を回避できない', async () => {
    signIn(OTHER_ID);
    const data = form({ password: 'password123' });
    for (const key of ['actorId', 'targetId', 'passwordHash']) data.append(key, FIXED_ID);
    const forged = {
      status: 'error',
      code: 'INVALID_INPUT',
      message: '',
      fieldErrors: {},
      attempt: 41,
    } as const;

    const state = await deleteAccountAction(FIXED_ID, forged, data);

    expect(state).toMatchObject({ code: 'FORBIDDEN', attempt: 42 });
    expect(users.accounts).toHaveLength(2);
  });

  it('未認証なら削除せず /login へredirectする', async () => {
    signIn(null);

    await expect(
      deleteAccountAction(FIXED_ID, initialAccountDeleteState, form({ password: 'password123' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(boundary.calls).toEqual(['auth', 'redirect:/login']);
    expect(users.accounts).toHaveLength(2);
  });

  it.each([
    ['欠落', form({})],
    ['File', form({ password: new Blob(['password123']) })],
    ['重複キー', form({ password: ['password123', 'password123'] })],
  ])('不正な形式の送信（%s）は認証・削除しない', async (_label, data) => {
    const state = await deleteAccountAction(FIXED_ID, initialAccountDeleteState, data);

    expect(state).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(boundary.calls).toEqual([]);
    expect(users.accounts).toHaveLength(2);
  });

  it('入力違反・誤パスワードは欄エラーにし、signOut・revalidateをせず、パスワードを返さない', async () => {
    const invalid = await deleteAccountAction(FIXED_ID, initialAccountDeleteState, form({ password: 'short' }));
    expect(invalid).toMatchObject({ code: 'INVALID_INPUT', fieldErrors: { password: [expect.any(String)] } });

    const wrong = await deleteAccountAction(FIXED_ID, invalid, form({ password: 'wrong-pass' }));
    expect(wrong).toMatchObject({
      status: 'error',
      code: 'INVALID_PASSWORD',
      fieldErrors: { password: ['パスワードが違います'] },
      attempt: 2,
    });
    expect(JSON.stringify([invalid, wrong])).not.toMatch(/wrong-pass|short|fake-hash|password123/);
    expect(boundary.calls).toEqual(['auth', 'auth']);
    expect(users.accounts).toHaveLength(2);
  });

  it('DB・Hasherの障害は全体メッセージにし、signOut・revalidateをしない', async () => {
    vi.spyOn(passwords, 'verify').mockRejectedValue(new Error('down'));

    const state = await deleteAccountAction(
      FIXED_ID,
      initialAccountDeleteState,
      form({ password: 'password123' }),
    );

    expect(state).toMatchObject({
      status: 'error',
      code: 'UNAVAILABLE',
      message: '削除できませんでした。時間をおいて再度お試しください',
      fieldErrors: {},
    });
    expect(boundary.calls).toEqual(['auth']);
  });

  it.each([
    ['throwする', () => Promise.reject(new Error('signOut failed'))],
    ['エラーURLを返す', () => Promise.resolve({ redirect: 'http://localhost:3000/api/auth/error?error=Configuration' })],
    ['想定外の結果を返す', () => Promise.resolve(undefined)],
  ])('signOutが%s場合は削除を再実行せず、後処理失敗の通知で /login へ移動する', async (_label, result) => {
    boundary.signOut.mockImplementation(result);
    const remove = vi.spyOn(users, 'deleteById');

    await expect(
      deleteAccountAction(FIXED_ID, initialAccountDeleteState, form({ password: 'password123' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(boundary.calls).toEqual([
      'auth',
      ...REVALIDATIONS,
      'signOut',
      `cookie:${ACCOUNT_DELETED_COOKIE}=signout-failed`,
      'redirect:/login',
    ]);
  });

  it('同じセッションで対象が既にない場合は、他人を操作せずログアウトし、成功とは別の通知で /login へ戻す', async () => {
    await users.deleteById(FIXED_ID); // 別のリクエストで先に削除された
    const before = structuredClone(users.accounts);

    await expect(
      deleteAccountAction(FIXED_ID, initialAccountDeleteState, form({ password: 'password123' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(users.accounts).toEqual(before);
    expect(boundary.calls).toEqual([
      'auth',
      ...REVALIDATIONS,
      'signOut',
      `cookie:${ACCOUNT_DELETED_COOKIE}=account-missing`,
      'redirect:/login',
    ]);
  });
});
