import { toAccountProfile, type AccountProfile } from '@/domain/users/user';
import type { PasswordHasher } from './ports/password-hasher';
import type { UserRepository } from './ports/user-repository';

export type AuthenticationDependencies = {
  users: UserRepository;
  passwords: PasswordHasher;
};

export type Credentials = { displayId: string; password: string };

/**
 * ID・パスワードを照合し、一致すれば公開プロフィールを返す。
 * 不一致はnull、DB障害などはthrowして資格情報の不一致と区別する。
 * パスワードは登録時と同じくtrim・正規化しない。
 */
export async function authenticateUser(
  deps: AuthenticationDependencies,
  { displayId, password }: Credentials,
): Promise<AccountProfile | null> {
  const account = await deps.users.findByDisplayId(displayId);
  if (!account) return null;
  if (!(await deps.passwords.verify(password, account.passwordHash))) return null;
  return toAccountProfile(account);
}
