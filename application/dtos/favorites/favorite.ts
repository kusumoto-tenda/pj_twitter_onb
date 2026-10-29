import type { TimelineItem } from '@/application/dtos/timeline/timeline';

/** お気に入り一覧の順番キー（保存した日時の降順、同時刻はお気に入りUUIDの降順）。createdAtはマイクロ秒のUTC文字列。 */
export type FavoriteCursor = { createdAt: string; favoriteId: string };

/** 保存した元投稿のカード（itemは元投稿の現在の内容。リツイートの実行者は付けない）。 */
export type FavoriteEntry = { favoriteId: string; favoritedAt: string; item: TimelineItem };

export type FavoritePage = { items: FavoriteEntry[]; nextCursor: FavoriteCursor | null };

export const FAVORITES_PAGE_SIZE = 20;

export type SetFavoriteResult =
  | { ok: true; active: boolean }
  | { ok: false; code: 'UNAUTHENTICATED' | 'SESSION_CHANGED' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'UNAVAILABLE' };

export type GetFavoritesResult = { ok: true; page: FavoritePage } | { ok: false; code: 'UNAUTHENTICATED' | 'UNAVAILABLE' };
