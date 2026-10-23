import { validateAccountInput } from '@/domain/users/account-validation';
import {
  toAccountProfile,
  type AccountProfile,
  type CreateAccountInput,
  type FieldErrors,
  type StoredAccount,
} from '@/domain/users/user';
import type { PasswordHasher } from './ports/password-hasher';
import type { UserRepository } from './ports/user-repository';

export type AccountDependencies = {
  users: UserRepository;
  passwords: PasswordHasher;
  newId: () => string;
  now: () => Date;
};

export type CreateAccountResult =
  | { ok: true; account: AccountProfile }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors }
  | { ok: false; code: 'DISPLAY_ID_TAKEN' }
  | { ok: false; code: 'UNAVAILABLE' };

export async function createAccount(
  deps: AccountDependencies,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  const validation = validateAccountInput(input);
  if (!validation.ok) {
    return { ok: false, code: 'INVALID_INPUT', fieldErrors: validation.fieldErrors };
  }
  const { password, ...profile } = validation.value;

  try {
    // 重いハッシュ計算を避けるための事前確認。一意性の最終判断はcreateの結果で行う。
    if (await deps.users.findByDisplayId(profile.displayId)) {
      return { ok: false, code: 'DISPLAY_ID_TAKEN' };
    }

    const account: StoredAccount = {
      id: deps.newId(),
      ...profile,
      createdAt: deps.now(),
      passwordHash: await deps.passwords.hash(password),
    };
    if ((await deps.users.create(account)) === 'display-id-taken') {
      return { ok: false, code: 'DISPLAY_ID_TAKEN' };
    }
    return { ok: true, account: toAccountProfile(account) };
  } catch {
    // 入力内容を含む可能性があるため、エラー詳細は外に出さない。
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
