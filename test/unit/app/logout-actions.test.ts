import { beforeEach, describe, expect, it, vi } from 'vitest';

const A = '00000000-0000-4000-8000-abcdef000001';
const B = '00000000-0000-4000-8000-abcdef000002';
const boundary = vi.hoisted(() => ({
  auth: vi.fn(),
  end: vi.fn(),
  revalidate: vi.fn(),
  cookieSet: vi.fn(),
  redirect: vi.fn(),
  events: [] as string[],
}));

vi.mock('@/app/_auth/auth', () => ({ auth: boundary.auth }));
vi.mock('@/main/container/session', () => ({ getSessionDependencies: () => ({ sessions: { end: boundary.end } }) }));
// ログアウトは利用者の実在・DB障害に依存しない。
vi.mock('@/main/container/account', () => ({ getAccountDependencies: () => { throw new Error('DB must not be opened'); } }));
vi.mock('@/infra/persistence/postgres/db/client', () => ({ getSql: () => { throw new Error('DB must not be opened'); } }));
vi.mock('next/cache', () => ({ revalidatePath: boundary.revalidate }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: boundary.cookieSet }) }));
vi.mock('next/navigation', () => ({ redirect: boundary.redirect }));

const { logoutAction } = await import('@/app/logout/actions');
const { initialLogoutState } = await import('@/app/logout/form-state');

function form(value: string | string[] | Blob | null = A) {
  const data = new FormData();
  if (value !== null) {
    for (const item of Array.isArray(value) ? value : [value]) data.append('expectedActorId', item);
  }
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.events.length = 0;
  boundary.auth.mockResolvedValue({ user: { id: A } });
  boundary.end.mockImplementation(async () => { boundary.events.push('end'); return true; });
  boundary.revalidate.mockImplementation(() => { boundary.events.push('invalidate'); });
  boundary.cookieSet.mockImplementation(() => { boundary.events.push('flash'); });
  boundary.redirect.mockImplementation((url: string) => { boundary.events.push(`redirect:${url}`); throw new Error('NEXT_REDIRECT'); });
});

function expectNoSuccess() {
  expect(boundary.revalidate).not.toHaveBeenCalled();
  expect(boundary.cookieSet).not.toHaveBeenCalled();
  expect(boundary.redirect).not.toHaveBeenCalled();
}

describe('logoutAction', () => {
  it('authのUUIDだけで終了し、root layoutを無効化して表示専用Cookieを設定後、固定先へredirectする', async () => {
    const data = form();
    data.append('actorId', B);
    data.append('returnTo', 'https://untrusted.example/');

    await expect(logoutAction(initialLogoutState, data)).rejects.toThrow('NEXT_REDIRECT');

    expect(boundary.auth).toHaveBeenCalledTimes(1);
    expect(boundary.end).toHaveBeenCalledExactlyOnceWith();
    expect(boundary.revalidate).toHaveBeenCalledExactlyOnceWith('/', 'layout');
    expect(boundary.cookieSet).toHaveBeenCalledExactlyOnceWith('flash_session', 'logged-out', {
      path: '/', maxAge: 60, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: false,
    });
    expect(boundary.redirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(boundary.events).toEqual(['end', 'invalidate', 'flash', 'redirect:/login']);
  });

  it('UUIDの大文字小文字を揃えて比較する', async () => {
    boundary.auth.mockResolvedValue({ user: { id: A.toUpperCase() } });
    await expect(logoutAction(initialLogoutState, form(A))).rejects.toThrow('NEXT_REDIRECT');
    expect(boundary.end).toHaveBeenCalledTimes(1);
  });

  it.each([null, { user: {} }])('既に匿名・期限切れでもセッションを清掃してログインへ移動する (%j)', async (session) => {
    boundary.auth.mockResolvedValue(session);
    await expect(logoutAction(initialLogoutState, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(boundary.end).toHaveBeenCalledTimes(1);
  });

  it('別の利用者へ切り替わっていたら新しいセッションを終了しない', async () => {
    boundary.auth.mockResolvedValue({ user: { id: B } });
    expect(await logoutAction(initialLogoutState, form())).toMatchObject({ status: 'error', code: 'SESSION_CHANGED' });
    expect(boundary.end).not.toHaveBeenCalled();
    expectNoSuccess();
  });

  it.each([null, '', 'not-a-uuid', ` ${A}`, [A, A], new Blob([A])])('expectedActorIdは単一の正しいUUIDだけを受け付ける (%j)', async (value) => {
    expect(await logoutAction(initialLogoutState, form(value))).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(boundary.end).not.toHaveBeenCalled();
    expectNoSuccess();
  });

  it('authの失敗は秘密を含まない再試行案内にし、セッションを終了しない', async () => {
    boundary.auth.mockRejectedValue(new Error('secret auth host'));
    expect(await logoutAction(initialLogoutState, form())).toEqual({
      status: 'error', code: 'UNAVAILABLE', message: 'ログアウトできませんでした。もう一度お試しください', attempt: 1,
    });
    expect(boundary.end).not.toHaveBeenCalled();
    expectNoSuccess();
  });

  it('authから不正なUUIDが返っても匿名扱いでセッションを終了しない', async () => {
    boundary.auth.mockResolvedValue({ user: { id: 'not-a-uuid' } });
    expect(await logoutAction(initialLogoutState, form())).toMatchObject({ status: 'error', code: 'UNAVAILABLE' });
    expect(boundary.end).not.toHaveBeenCalled();
    expectNoSuccess();
  });

  it.each(['false', 'throw'])('セッション終了が%sなら成功通知・無効化・redirectは行わない', async (mode) => {
    if (mode === 'false') boundary.end.mockResolvedValue(false);
    else boundary.end.mockRejectedValue(new Error('secret signout error'));

    const previous = { status: 'error', code: 'UNAVAILABLE', message: '前の失敗', attempt: 3 } as const;
    expect(await logoutAction(previous, form())).toEqual({
      status: 'error', code: 'UNAVAILABLE', message: 'ログアウトできませんでした。もう一度お試しください', attempt: 4,
    });
    expectNoSuccess();
  });
});
