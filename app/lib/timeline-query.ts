import type { TimelineCursor, TimelineEventKind } from '@/application/dtos/timeline/timeline';
import {
  decodeCursorParts,
  encodeCursorParts,
  isUtcMicros,
  isUuid,
  type SearchParamValue,
} from './cursor-validation';

export { MAX_CURSOR_LENGTH } from './cursor-validation';

const KINDS: readonly TimelineEventKind[] = ['tweet', 'retweet'];

/** `follow` が単一の文字列 'true' のときだけフォロー一覧にする。 */
export function parseFollowParam(value: SearchParamValue): boolean {
  return value === 'true';
}

export function encodeCursor(cursor: TimelineCursor): string {
  return encodeCursorParts([cursor.eventAt, cursor.kind, cursor.eventId]);
}

/** 日時・種類・UUIDの3要素をタイムラインの順番キーとして検証する。 */
export function toTimelineCursor(
  eventAt: unknown,
  kind: unknown,
  eventId: unknown,
): TimelineCursor | null {
  if (!isUtcMicros(eventAt) || !KINDS.includes(kind as TimelineEventKind) || !isUuid(eventId)) {
    return null;
  }
  return { eventAt, kind: kind as TimelineEventKind, eventId: eventId.toLowerCase() };
}

/**
 * URLのカーソルを検証してデコードする。未指定は先頭（null）、不正な値はok: false。
 * 無効な値をDBへ渡さないよう、形・日時・種類・UUIDまで確認する。
 */
export function parseCursorParam(
  value: SearchParamValue,
): { ok: true; cursor: TimelineCursor | null } | { ok: false } {
  const parts = decodeCursorParts(value, 3);
  if (parts === null) return { ok: true, cursor: null };
  if (parts === undefined) return { ok: false };
  const cursor = toTimelineCursor(parts[0], parts[1], parts[2]);
  return cursor ? { ok: true, cursor } : { ok: false };
}

/** メイン画面のURL。フォロー条件を保持し、カーソルは指定時だけ付ける。 */
export function timelineHref({
  followingOnly,
  cursor,
}: {
  followingOnly: boolean;
  cursor: TimelineCursor | null;
}): string {
  const params = new URLSearchParams();
  if (followingOnly) params.set('follow', 'true');
  if (cursor) params.set('cursor', encodeCursor(cursor));
  const query = params.toString();
  return query ? `/?${query}` : '/';
}
