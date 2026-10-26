import {
  validateEditProfileInput,
  type EditProfileFieldErrors,
  type EditProfileInput,
} from '@/domain/users/profile-edit-validation';
import type { AccountProfile } from '@/domain/users/user';
import type { UserRepository } from './ports/user-repository';

export type UpdateProfileResult =
  | { ok: true; profile: AccountProfile }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'DISPLAY_ID_TAKEN' | 'UNAVAILABLE';
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: EditProfileFieldErrors };

/**
 * 本人のプロフィール（名前・ID・bio）を更新する。
 * actorIdは保存のたびにサーバーで確認したログイン中の利用者。本人以外はRepositoryを呼ばない。
 */
export async function updateProfile(
  deps: { users: Pick<UserRepository, 'updateProfile'> },
  { actorId, targetId, input }: { actorId: string | null; targetId: string; input: EditProfileInput },
): Promise<UpdateProfileResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  if (actorId !== targetId) return { ok: false, code: 'FORBIDDEN' };

  const validation = validateEditProfileInput(input);
  if (!validation.ok) {
    return { ok: false, code: 'INVALID_INPUT', fieldErrors: validation.fieldErrors };
  }

  try {
    const outcome = await deps.users.updateProfile(targetId, validation.value);
    switch (outcome.status) {
      case 'updated':
        return { ok: true, profile: outcome.profile };
      case 'display-id-taken':
        return { ok: false, code: 'DISPLAY_ID_TAKEN' };
      case 'not-found':
        return { ok: false, code: 'NOT_FOUND' };
    }
  } catch {
    // 入力内容を含む可能性があるため、エラー詳細は外に出さない。
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
