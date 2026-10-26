import type { FavoriteCursor } from '@/application/favorites/favorite';
import { decodeCursorParts, encodeCursorParts, isUtcMicros, isUuid, type SearchParamValue } from './cursor-validation';

const SCOPE = 'favorites';

/**
 * カーソルは本人のUUIDと一覧の種類に結び付けてエンコードする。
 * 他人のカーソルや別の一覧のカーソルは不正として扱う（認証には使わない）。
 */
export function encodeFavoriteCursor(actorId: string, cursor: FavoriteCursor): string {
  return encodeCursorParts([actorId, SCOPE, cursor.createdAt, cursor.favoriteId]);
}

export function parseFavoriteCursor(
  value: SearchParamValue,
  actorId: string,
): { ok: true; cursor: FavoriteCursor | null } | { ok: false } {
  const parts = decodeCursorParts(value, 4);
  if (parts === null) return { ok: true, cursor: null };
  if (parts === undefined) return { ok: false };
  const [owner, scope, createdAt, favoriteId] = parts;
  if (!isUuid(owner) || owner.toLowerCase() !== actorId.toLowerCase() || scope !== SCOPE) return { ok: false };
  if (!isUtcMicros(createdAt) || !isUuid(favoriteId)) return { ok: false };
  return { ok: true, cursor: { createdAt, favoriteId: favoriteId.toLowerCase() } };
}

/** お気に入り一覧のURL。カーソル（encodeFavoriteCursorの結果）は指定時だけ付ける。 */
export function favoritesHref(cursor: string | null): string {
  return cursor ? `/favorites?${new URLSearchParams({ cursor })}` : '/favorites';
}
