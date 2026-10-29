import { describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/usecases/users/create-account';
import {
  FIXED_ID,
  FIXED_NOW,
  createTestDependencies,
  validInput,
} from '@/test/support/account-fixtures';

describe('createAccount', () => {
  it('正常入力なら1件保存し、注入したUUID・日時と元の表記のIDを持つプロフィールを返す', async () => {
    const { deps, users } = createTestDependencies();

    const result = await createAccount(deps, validInput);

    expect(result).toEqual({
      ok: true,
      account: {
        id: FIXED_ID,
        name: 'アリス',
        displayId: 'Alice_1',
        bio: 'こんにちは',
        createdAt: FIXED_NOW,
      },
    });
    expect(users.accounts).toHaveLength(1);
  });

  it('Hasherの返した値をpasswordHashとして保存し、平文は保存しない', async () => {
    const { deps, users } = createTestDependencies();

    await createAccount(deps, validInput);

    expect(users.accounts[0].passwordHash).toBe('fake-hash:password123');
    expect(JSON.stringify(users.accounts[0])).not.toContain('"password"');
  });

  it('成功結果にpasswordとpasswordHashを含めない', async () => {
    const { deps } = createTestDependencies();

    const result = await createAccount(deps, validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.account).not.toHaveProperty('password');
      expect(result.account).not.toHaveProperty('passwordHash');
    }
  });

  it('無効入力ならINVALID_INPUTを返し、ハッシュ・保存を行わない', async () => {
    const { deps, users, passwords } = createTestDependencies();
    const hash = vi.spyOn(passwords, 'hash');
    const create = vi.spyOn(users, 'create');

    const result = await createAccount(deps, { ...validInput, name: '', password: 'short' });

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { name: expect.any(Array), password: expect.any(Array) },
    });
    expect(hash).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('Alice_1の登録後にalice_1を登録するとDISPLAY_ID_TAKENになり件数が増えない', async () => {
    const { deps, users } = createTestDependencies();
    await createAccount(deps, validInput);

    const result = await createAccount(deps, { ...validInput, displayId: 'alice_1' });

    expect(result).toEqual({ ok: false, code: 'DISPLAY_ID_TAKEN' });
    expect(users.accounts).toHaveLength(1);
  });

  it('Repositoryが競合を返したらDISPLAY_ID_TAKENにする（事前検索に依存しない）', async () => {
    const { deps, users } = createTestDependencies();
    vi.spyOn(users, 'findByDisplayId').mockResolvedValue(null);
    vi.spyOn(users, 'create').mockResolvedValue('display-id-taken');

    const result = await createAccount(deps, validInput);

    expect(result).toEqual({ ok: false, code: 'DISPLAY_ID_TAKEN' });
  });

  it('Repositoryがthrowしたら UNAVAILABLE にする', async () => {
    const { deps, users } = createTestDependencies();
    vi.spyOn(users, 'create').mockRejectedValue(new Error('connection refused'));

    const result = await createAccount(deps, validInput);

    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });

  it('Hasherがthrowしたら UNAVAILABLE にし、保存しない', async () => {
    const { deps, users, passwords } = createTestDependencies();
    vi.spyOn(passwords, 'hash').mockRejectedValue(new Error('out of memory'));

    const result = await createAccount(deps, validInput);

    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(users.accounts).toHaveLength(0);
  });
});
