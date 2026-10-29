import type { FavoriteCursor, FavoritePage } from '@/application/dtos/favorites/favorite';

export type { FavoriteCursor } from '@/application/dtos/favorites/favorite';

/** 本人のお気に入り一覧の読み取り。取得障害はthrowする。 */
export interface FavoriteQuery {
  findPage(input: { actorId: string; after: FavoriteCursor | null; limit: number }): Promise<FavoritePage>;
}
