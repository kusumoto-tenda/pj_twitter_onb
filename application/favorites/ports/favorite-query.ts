import type { FavoriteCursor, FavoritePage } from '../favorite';

export type { FavoriteCursor } from '../favorite';

/** 本人のお気に入り一覧の読み取り。取得障害はthrowする。 */
export interface FavoriteQuery {
  findPage(input: { actorId: string; after: FavoriteCursor | null; limit: number }): Promise<FavoritePage>;
}
