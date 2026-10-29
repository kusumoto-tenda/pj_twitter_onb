import 'server-only';
import { auth } from '@/app/_auth/auth';
import { getAccountDependencies } from '@/main/container/account';
import { findAccountProfile } from '@/application/usecases/users/find-account-profile';
import type { AccountProfile } from '@/domain/entities/users/user';

export type Viewer =
  | { status: 'anonymous' }
  | { status: 'signed-in'; profile: AccountProfile }
  | { status: 'unavailable' };

/**
 * セッションのUUIDに対応する利用者がDBに実在するかで閲覧者を決める。
 * URLやクライアントから渡されたUUIDは使わない。DB障害は「利用者なし」と区別する。
 */
export async function resolveViewer(): Promise<Viewer> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return { status: 'anonymous' };
  try {
    const profile = await findAccountProfile(getAccountDependencies(), id);
    return profile ? { status: 'signed-in', profile } : { status: 'anonymous' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** 実在を確認したログイン中の利用者だけ、自分のプロフィールへのナビを出す。 */
export function viewerProfileDisplayId(viewer: Viewer): string | null {
  return viewer.status === 'signed-in' ? viewer.profile.displayId : null;
}
