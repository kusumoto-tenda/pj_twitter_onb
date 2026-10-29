import { describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/usecases/users/create-account';
import { deleteAccount } from '@/application/usecases/users/delete-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';

async function setup() {
  const context = createTestDependencies();
  await createAccount(context.deps, validInput); // FIXED_ID, password123
  await createAccount(context.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  const { users, passwords } = context;
  return { users, passwords, deps: { users, passwords } };
}

describe('deleteAccount', () => {
  it('本人が正しいパスワードを入力すれば削除し、秘密情報を含まない成功結果を返す', async () => {
    const { deps, users } = await setup();

    const result = await deleteAccount(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      password: 'password123',
    });

    expect(result).toEqual({ ok: true });
    expect(users.accounts.map((a) => a.id)).toEqual([OTHER_ID]);
  });

  it('別アカウントからは照合も削除も行わない', async () => {
    const findById = vi.fn();
    const deleteById = vi.fn();
    const verify = vi.fn();
    const result = await deleteAccount(
      { users: { findById, deleteById }, passwords: { verify } },
      { actorId: 'actor-a', targetId: 'target-b', password: 'password123' },
    );
    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(findById).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(deleteById).not.toHaveBeenCalled();
  });

  it('未認証なら照合も削除も行わない', async () => {
    const findById = vi.fn();
    const deleteById = vi.fn();
    const verify = vi.fn();

    const result = await deleteAccount(
      { users: { findById, deleteById }, passwords: { verify } },
      { actorId: null, targetId: FIXED_ID, password: 'password123' },
    );

    expect(result).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect([findById, verify, deleteById].every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    ['空欄', ''],
    ['7文字', 'a'.repeat(7)],
    ['51文字', 'a'.repeat(51)],
  ])('パスワードの長さ違反（%s）はDB読取・照合・削除を行わない', async (_label, password) => {
    const findById = vi.fn();
    const deleteById = vi.fn();
    const verify = vi.fn();

    const result = await deleteAccount(
      { users: { findById, deleteById }, passwords: { verify } },
      { actorId: FIXED_ID, targetId: FIXED_ID, password },
    );

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { password: [expect.any(String)] },
    });
    expect([findById, verify, deleteById].every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('対象が存在しなければ照合・削除せずNOT_FOUNDを返す', async () => {
    const { deps, users, passwords } = await setup();
    const verify = vi.spyOn(passwords, 'verify');
    const remove = vi.spyOn(users, 'deleteById');
    const missing = '00000000-0000-4000-8000-00000000dead';

    const result = await deleteAccount(deps, { actorId: missing, targetId: missing, password: 'password123' });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(verify).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('パスワードが違えば削除せずINVALID_PASSWORDを返す', async () => {
    const { deps, users } = await setup();
    const remove = vi.spyOn(users, 'deleteById');

    const result = await deleteAccount(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      password: 'password124',
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_PASSWORD' });
    expect(remove).not.toHaveBeenCalled();
    expect(users.accounts).toHaveLength(2);
  });

  it('パスワードをtrim・正規化せずに照合する', async () => {
    const { deps, passwords } = await setup();
    const verify = vi.spyOn(passwords, 'verify');

    const result = await deleteAccount(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      password: ' password123 ',
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_PASSWORD' });
    expect(verify).toHaveBeenCalledWith(' password123 ', expect.any(String));
  });

  it('照合後に別のリクエストが先に削除していたらNOT_FOUNDを返す', async () => {
    const { deps, users } = await setup();
    vi.spyOn(users, 'deleteById').mockResolvedValue('not-found');

    const result = await deleteAccount(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      password: 'password123',
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it.each([
    ['findById', (c: Awaited<ReturnType<typeof setup>>) => vi.spyOn(c.users, 'findById')],
    ['verify', (c: Awaited<ReturnType<typeof setup>>) => vi.spyOn(c.passwords, 'verify')],
    ['deleteById', (c: Awaited<ReturnType<typeof setup>>) => vi.spyOn(c.users, 'deleteById')],
  ] as const)('%sの例外はUNAVAILABLEにする', async (_method, spy) => {
    const context = await setup();
    spy(context).mockRejectedValue(new Error('down'));

    const result = await deleteAccount(context.deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      password: 'password123',
    });

    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
