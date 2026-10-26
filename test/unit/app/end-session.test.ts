import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/app/_auth/auth', () => ({ signOut: boundary.signOut }));
// ログアウトは利用者DBの実在やDB接続を必要としない。
vi.mock('@/app/_auth/viewer', () => { throw new Error('ログアウトでresolveViewerを読み込んではいけません'); });
vi.mock('@/infra/db/client', () => { throw new Error('ログアウトでDBへ依存してはいけません'); });

import { endSession } from '@/app/_auth/end-session';
import { getSessionDependencies } from '@/app/_composition/session';

beforeEach(() => {
  boundary.signOut.mockReset().mockResolvedValue({ redirect: 'http://localhost:3000/login' });
});

describe('endSession', () => {
  it.each([
    ['絶対URL', 'http://localhost:3000/login'],
    ['相対URL', '/login'],
  ])('Auth.jsが正常な%sを返せば終了成功とし、Cookie操作と遷移先の指定をAuth.jsへ任せる', async (_name, redirect) => {
    boundary.signOut.mockResolvedValue({ redirect, status: 302, cookies: [] });

    expect(await endSession()).toBe(true);
    expect(boundary.signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false, redirectTo: '/login' });
  });

  it.each([
    { redirect: '/login?error=AccessDenied' },
    { redirect: 'http://localhost:3000/api/auth/error?error=Configuration' },
  ])('エラーを含む遷移先は、例外がなくても成功扱いしない（%j）', async (result) => {
    boundary.signOut.mockResolvedValue(result);

    expect(await endSession()).toBe(false);
    expect(boundary.signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false, redirectTo: '/login' });
  });

  it.each([
    undefined,
    null,
    true,
    '/login',
    {},
    { status: 200, cookies: [] },
    { redirect: null },
    { redirect: 123 },
    { redirect: 'http://[' },
  ])('想定外の戻り値は成功扱いしない（%j）', async (result) => {
    boundary.signOut.mockResolvedValue(result);

    expect(await endSession()).toBe(false);
    expect(boundary.signOut).toHaveBeenCalledTimes(1);
  });

  it('Auth.jsの例外はそのまま呼び出し元へ渡す（applicationがUNAVAILABLEへ変換する）', async () => {
    const failure = new Error('signOut failed');
    boundary.signOut.mockRejectedValue(failure);

    await expect(endSession()).rejects.toBe(failure);
    expect(boundary.signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false, redirectTo: '/login' });
  });
});

describe('getSessionDependencies', () => {
  it('DBや利用者確認に依存せず終了ポートを組み立て、呼ばれたときだけAuth.jsで終了する', async () => {
    const deps = getSessionDependencies();
    expect(boundary.signOut).not.toHaveBeenCalled();

    expect(await deps.sessions.end()).toBe(true);
    expect(boundary.signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false, redirectTo: '/login' });
  });
});
