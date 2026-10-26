import { validatePassword } from '@/domain/users/account-validation';
import type { PasswordHasher } from './ports/password-hasher';
import type { UserRepository } from './ports/user-repository';

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: { password: string[] } }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_PASSWORD' | 'UNAVAILABLE';
    };

/**
 * 本人のアカウントを、現在のパスワードを確認してから削除する。
 * actorIdは保存のたびにサーバーで確認したセッションのUUID。本人以外はDBもHasherも使わない。
 * パスワードは登録時と同じくtrim・正規化しない。
 */
export async function deleteAccount(
  deps: {
    users: Pick<UserRepository, 'findById' | 'deleteById'>;
    passwords: Pick<PasswordHasher, 'verify'>;
  },
  { actorId, targetId, password }: { actorId: string | null; targetId: string; password: string },
): Promise<DeleteAccountResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  if (actorId !== targetId) return { ok: false, code: 'FORBIDDEN' };

  const passwordErrors = validatePassword(password);
  if (passwordErrors.length > 0) {
    return { ok: false, code: 'INVALID_INPUT', fieldErrors: { password: passwordErrors } };
  }

  try {
    const account = await deps.users.findById(targetId);
    if (!account) return { ok: false, code: 'NOT_FOUND' };
    if (!(await deps.passwords.verify(password, account.passwordHash))) {
      return { ok: false, code: 'INVALID_PASSWORD' };
    }
    // 照合後に別のリクエストが先に削除していた場合は、削除成功とは扱わない。
    const outcome = await deps.users.deleteById(targetId);
    return outcome === 'deleted' ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
  } catch {
    // 入力内容を含む可能性があるため、エラー詳細は外に出さない。
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
