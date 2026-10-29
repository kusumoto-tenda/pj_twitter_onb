import { describe, expect, it, vi } from 'vitest';
import { authenticateUser } from '@/application/usecases/users/authenticate-user';
import { createAccount } from '@/application/usecases/users/create-account';
import {
  FIXED_ID,
  FIXED_NOW,
  createTestDependencies,
  validInput,
} from '@/test/support/account-fixtures';

async function setup() {
  const context = createTestDependencies();
  await createAccount(context.deps, validInput);
  return context;
}

describe('authenticateUser', () => {
  it('正しいID・パスワードなら公開プロフィールを返す', async () => {
    const { deps } = await setup();

    const profile = await authenticateUser(deps, { displayId: 'Alice_1', password: 'password123' });

    expect(profile).toEqual({
      id: FIXED_ID,
      name: 'アリス',
      displayId: 'Alice_1',
      bio: 'こんにちは',
      createdAt: FIXED_NOW,
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('IDの大文字小文字が違っても正しいパスワードなら認証する', async () => {
    const { deps } = await setup();

    const profile = await authenticateUser(deps, { displayId: 'ALICE_1', password: 'password123' });

    expect(profile?.id).toBe(FIXED_ID);
  });

  it('未登録のIDなら null を返す', async () => {
    const { deps } = await setup();

    expect(await authenticateUser(deps, { displayId: 'Bob_12', password: 'password123' })).toBeNull();
  });

  it('パスワードが違えば null を返す', async () => {
    const { deps } = await setup();

    expect(await authenticateUser(deps, { displayId: 'Alice_1', password: 'password124' })).toBeNull();
  });

  it('パスワードをtrimしない', async () => {
    const { deps } = await setup();

    expect(await authenticateUser(deps, { displayId: 'Alice_1', password: ' password123 ' })).toBeNull();
  });

  it.each([
    ['IDの形式違反', { displayId: '@alice', password: 'password123' }],
    ['IDの長さ違反', { displayId: 'abcd', password: 'password123' }],
    ['パスワードの長さ違反', { displayId: 'Alice_1', password: 'short' }],
    ['パスワードが51文字', { displayId: 'Alice_1', password: 'a'.repeat(51) }],
  ])('不正な資格情報（%s）なら null を返し、Repository・Hasherを呼ばない', async (_label, credentials) => {
    const { deps, users, passwords } = await setup();
    const find = vi.spyOn(users, 'findByDisplayId');
    const verify = vi.spyOn(passwords, 'verify');

    expect(await authenticateUser(deps, credentials)).toBeNull();
    expect(find).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('DB障害は資格情報不一致と区別してthrowする', async () => {
    const { deps, users } = await setup();
    vi.spyOn(users, 'findByDisplayId').mockRejectedValue(new Error('connection refused'));

    await expect(
      authenticateUser(deps, { displayId: 'Alice_1', password: 'password123' }),
    ).rejects.toThrow();
  });
});
