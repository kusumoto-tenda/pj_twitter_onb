import { FAVORITES_PAGE_SIZE, type FavoriteCursor, type GetFavoritesResult } from '@/application/dtos/favorites/favorite';
import type { FavoriteQuery } from '@/application/query_service_ifs/favorites/favorite-query';

/** ログイン中の本人のお気に入りを20件ずつ取得する。対象はセッションで確認した利用者だけ（URLの値で変えない）。 */
export async function getFavorites(
  deps: { query: FavoriteQuery },
  { actorId, after }: { actorId: string | null; after: FavoriteCursor | null },
): Promise<GetFavoritesResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  try {
    return { ok: true, page: await deps.query.findPage({ actorId, after, limit: FAVORITES_PAGE_SIZE }) };
  } catch {
    // 取得障害を0件として表示しない。
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
