import { describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { updateProfile } from '@/application/users/update-profile';
import {
  FIXED_ID,
  FIXED_NOW,
  createTestDependencies,
  validInput,
} from '@/test/support/account-fixtures';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';

async function setup() {
  const context = createTestDependencies();
  await createAccount(context.deps, validInput); // FIXED_ID: Alice_1
  await createAccount(context.deps, { ...validInput, displayId: 'Bob_12', name: 'ボブ' }); // 2件目
  return context;
}

describe('updateProfile', () => {
  it('本人なら名前・ID・bioの3項目だけを更新し、公開プロフィールを返す', async () => {
    const { deps, users } = await setup();
    const before = { ...users.accounts[0] };

    const result = await updateProfile(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      input: { name: ' アリス改 ', displayId: 'Alice_99', bio: '変更後' },
    });

    expect(result).toEqual({
      ok: true,
      profile: { id: FIXED_ID, name: 'アリス改', displayId: 'Alice_99', bio: '変更後', createdAt: FIXED_NOW },
    });
    const after = users.accounts[0];
    expect(after).toMatchObject({ name: 'アリス改', displayId: 'Alice_99', bio: '変更後' });
    expect({ id: after.id, createdAt: after.createdAt, passwordHash: after.passwordHash }).toEqual({
      id: before.id,
      createdAt: before.createdAt,
      passwordHash: before.passwordHash,
    });
    if (result.ok) {
      expect(result.profile).not.toHaveProperty('passwordHash');
      expect(result.profile).not.toHaveProperty('password');
    }
  });

  it('別利用者は更新せずFORBIDDENを返す', async () => {
    const update = vi.fn();
    const result = await updateProfile(
      { users: { updateProfile: update } },
      {
        actorId: '00000000-0000-4000-8000-000000000001',
        targetId: '00000000-0000-4000-8000-000000000002',
        input: { name: '変更', displayId: 'Changed_1', bio: '' },
      },
    );
    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(update).not.toHaveBeenCalled();
  });

  it('未認証は更新せずUNAUTHENTICATEDを返す', async () => {
    const update = vi.fn();

    const result = await updateProfile(
      { users: { updateProfile: update } },
      { actorId: null, targetId: FIXED_ID, input: { name: '変更', displayId: 'Changed_1', bio: '' } },
    );

    expect(result).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(update).not.toHaveBeenCalled();
  });

  it('IDを変えずに保存できる', async () => {
    const { deps } = await setup();

    const result = await updateProfile(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      input: { name: '名前だけ変更', displayId: 'Alice_1', bio: '' },
    });

    expect(result).toMatchObject({ ok: true, profile: { name: '名前だけ変更', displayId: 'Alice_1' } });
  });

  it('本人のIDの大小文字だけの変更を許可し、表記を保持する', async () => {
    const { deps } = await setup();

    const result = await updateProfile(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      input: { name: 'アリス', displayId: 'ALICE_1', bio: '' },
    });

    expect(result).toMatchObject({ ok: true, profile: { displayId: 'ALICE_1' } });
  });

  it('bioを空にすると既存の内容を消す', async () => {
    const { deps, users } = await setup();

    await updateProfile(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      input: { name: 'アリス', displayId: 'Alice_1' },
    });

    expect(users.accounts[0].bio).toBe('');
  });

  it('無効入力はINVALID_INPUTを返し、保存しない', async () => {
    const { deps, users } = await setup();
    const update = vi.spyOn(users, 'updateProfile');

    const result = await updateProfile(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      input: { name: '', displayId: 'ab', bio: '' },
    });

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { name: expect.any(Array), displayId: expect.any(Array) },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('他人のIDと大小文字違いで重複したらDISPLAY_ID_TAKENを返し、何も変えない', async () => {
    const { deps, users } = await setup();
    const before = structuredClone(users.accounts);

    const result = await updateProfile(deps, {
      actorId: FIXED_ID,
      targetId: FIXED_ID,
      input: { name: '変更', displayId: 'BOB_12', bio: '変更' },
    });

    expect(result).toEqual({ ok: false, code: 'DISPLAY_ID_TAKEN' });
    expect(users.accounts).toEqual(before);
  });

  it('対象が存在しなければNOT_FOUNDを返す', async () => {
    const { deps } = await setup();

    const result = await updateProfile(deps, {
      actorId: '00000000-0000-4000-8000-00000000dead',
      targetId: '00000000-0000-4000-8000-00000000dead',
      input: { name: 'だれ', displayId: 'Nobody_1', bio: '' },
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('Repositoryの例外はUNAVAILABLEにする', async () => {
    const update = vi.fn().mockRejectedValue(new Error('db down'));

    const result = await updateProfile(
      { users: { updateProfile: update } },
      { actorId: OTHER_ID, targetId: OTHER_ID, input: { name: 'ボブ', displayId: 'Bob_12', bio: '' } },
    );

    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
