import type { JWT } from 'next-auth/jwt';
import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_MAX_AGE_SECONDS,
  createAuthConfig,
  createAuthorize,
  jwtCallback,
  sessionCallback,
} from '@/app/_auth/config';
import type { AccountProfile } from '@/domain/users/user';

const profile: AccountProfile = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'アリス',
  displayId: 'Alice_1',
  bio: '',
  createdAt: new Date('2026-10-23T00:00:00Z'),
};

describe('createAuthorize', () => {
  it('認証ユースケースに文字列の資格情報を渡し、UUIDをidとするユーザーを返す', async () => {
    const authenticate = vi.fn().mockResolvedValue(profile);
    const authorize = createAuthorize(authenticate);

    const user = await authorize({ displayId: 'Alice_1', password: 'password123' });

    expect(authenticate).toHaveBeenCalledWith({ displayId: 'Alice_1', password: 'password123' });
    expect(user).toEqual({ id: profile.id, name: 'アリス' });
  });

  it('認証に失敗したら null を返す', async () => {
    const authorize = createAuthorize(vi.fn().mockResolvedValue(null));

    expect(await authorize({ displayId: 'Alice_1', password: 'wrong-pass' })).toBeNull();
  });

  it('文字列でない・欠落した資格情報は認証せず null を返す', async () => {
    const authenticate = vi.fn();
    const authorize = createAuthorize(authenticate);

    expect(await authorize({ displayId: 'Alice_1' })).toBeNull();
    expect(await authorize({ displayId: ['Alice_1'], password: 'password123' })).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('DB障害は null（資格情報不一致）にせずthrowする', async () => {
    const authorize = createAuthorize(vi.fn().mockRejectedValue(new Error('db down')));

    await expect(authorize({ displayId: 'Alice_1', password: 'password123' })).rejects.toThrow();
  });
});

describe('JWT・session', () => {
  it('ログイン時にJWTのsubをUUIDにし、名前などの個人情報を含めない', async () => {
    const token = await jwtCallback({
      token: { name: 'アリス', email: null, picture: null, sub: 'other' } as JWT,
      user: { id: profile.id, name: 'アリス' },
    });

    expect(token).toEqual({ sub: profile.id });
  });

  it('既存のtokenは維持する', async () => {
    const token = await jwtCallback({ token: { sub: profile.id, iat: 1, exp: 2 } as JWT });

    expect(token).toEqual({ sub: profile.id, iat: 1, exp: 2 });
  });

  it('session.user.idにUUIDだけを渡す', async () => {
    const session = await sessionCallback({
      session: { user: { name: 'x', email: 'x@example.com' }, expires: '2026-10-30T00:00:00Z' },
      token: { sub: profile.id },
    });

    expect(session).toEqual({ user: { id: profile.id }, expires: '2026-10-30T00:00:00Z' });
  });

  it('JWT session・7日間・Credentialsで構成する', () => {
    const config = createAuthConfig(vi.fn());

    expect(config.session).toEqual({ strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS });
    expect(SESSION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(config.providers).toHaveLength(1);
    expect(config.pages?.signIn).toBe('/login');
  });
});

describe('logger', () => {
  it('資格情報の不一致は出力せず、その他のエラーは出力する', () => {
    const config = createAuthConfig(vi.fn());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const credentialsError = Object.assign(new Error('x'), { name: 'CredentialsSignin' });

    config.logger.error(credentialsError);
    expect(consoleError).not.toHaveBeenCalled();

    config.logger.error(new Error('db down'));
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
