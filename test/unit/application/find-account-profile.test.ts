import { describe, expect, it } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { findAccountProfile } from '@/application/users/find-account-profile';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';

describe('findAccountProfile', () => {
  it('UUIDに対応する公開プロフィールを返し、passwordHashを含めない', async () => {
    const { deps } = createTestDependencies();
    await createAccount(deps, validInput);

    const profile = await findAccountProfile(deps, FIXED_ID);

    expect(profile).toMatchObject({ id: FIXED_ID, name: 'アリス', displayId: 'Alice_1' });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('存在しなければ null を返す', async () => {
    const { deps } = createTestDependencies();

    expect(await findAccountProfile(deps, FIXED_ID)).toBeNull();
  });
});
