import type { ProfileLikesQuery } from './ports/profile-query';
import { PROFILE_PAGE_SIZE, type LikeCursor, type ProfileLikesPage } from './profile';

export type GetProfileLikesResult = { ok: true; page: ProfileLikesPage } | { ok: false; code: 'UNAVAILABLE' };

/**
 * 対象者がいいねした投稿を20件ずつ取得する。公開一覧なので未ログイン（viewerId: null）でも取得できる。
 * subjectIdは一覧の持ち主、viewerIdは本人状態（いいね・お気に入り）の判定に使う閲覧者。
 */
export async function getProfileLikes(
  deps: { query: ProfileLikesQuery },
  input: { subjectId: string; viewerId: string | null; after: LikeCursor | null },
): Promise<GetProfileLikesResult> {
  try {
    return { ok: true, page: await deps.query.findLikedPage({ ...input, limit: PROFILE_PAGE_SIZE }) };
  } catch {
    // 取得障害を0件として表示しない。
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
