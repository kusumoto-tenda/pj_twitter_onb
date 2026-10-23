import { validateDisplayId } from '@/domain/users/account-validation';
import type { ProfileQuery } from './ports/profile-query';
import type { ProfileSummary } from './profile';

export type GetProfileResult =
  | { ok: true; profile: ProfileSummary }
  | { ok: false; code: 'NOT_FOUND' | 'UNAVAILABLE' };

/** URLのユーザーIDから公開プロフィールを取得する。形式違反はDBを照会せずNOT_FOUNDにする。 */
export async function getProfile(
  deps: { query: Pick<ProfileQuery, 'findSummary'> },
  { displayId, viewerId }: { displayId: string; viewerId: string | null },
): Promise<GetProfileResult> {
  if (validateDisplayId(displayId).length > 0) return { ok: false, code: 'NOT_FOUND' };
  try {
    const profile = await deps.query.findSummary({ displayId, viewerId });
    return profile ? { ok: true, profile } : { ok: false, code: 'NOT_FOUND' };
  } catch {
    // 障害を「見つからない」と区別する。詳細は画面に出さない。
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
