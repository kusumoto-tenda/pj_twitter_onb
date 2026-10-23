import type { TimelineCursor, TimelineEventKind } from '@/application/timeline/timeline';

/** URLのカーソル文字列の上限。これを超える値はデコードしない。 */
export const MAX_CURSOR_LENGTH = 512;

type SearchParamValue = string | string[] | undefined;

const EVENT_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const KINDS: readonly TimelineEventKind[] = ['tweet', 'retweet'];

/** `follow` が単一の文字列 'true' のときだけフォロー一覧にする。 */
export function parseFollowParam(value: SearchParamValue): boolean {
  return value === 'true';
}

/** 実在する日時で、DBと同じ小数秒6桁のUTC表記か。 */
function isValidEventAt(value: unknown): value is string {
  if (typeof value !== 'string' || !EVENT_AT_PATTERN.test(value)) return false;
  // 年0000はJSでは有効だがPostgreSQLでは扱えないため拒否する。
  if (value.startsWith('0000-')) return false;
  const date = new Date(`${value.slice(0, 23)}Z`);
  // 2026-02-30 のような値はDateが繰り上げるため、往復した表記と比べて弾く。
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

export function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify([cursor.eventAt, cursor.kind, cursor.eventId])).toString(
    'base64url',
  );
}

/**
 * URLのカーソルを検証してデコードする。未指定は先頭（null）、不正な値はok: false。
 * 無効な値をDBへ渡さないよう、形・日時・種類・UUIDまで確認する。
 */
export function parseCursorParam(
  value: SearchParamValue,
): { ok: true; cursor: TimelineCursor | null } | { ok: false } {
  if (value === undefined) return { ok: true, cursor: null };
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CURSOR_LENGTH) {
    return { ok: false };
  }
  if (!BASE64URL_PATTERN.test(value)) return { ok: false };

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(decoded) || decoded.length !== 3) return { ok: false };

  const [eventAt, kind, eventId] = decoded as unknown[];
  if (!isValidEventAt(eventAt)) return { ok: false };
  if (!KINDS.includes(kind as TimelineEventKind)) return { ok: false };
  if (typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) return { ok: false };
  return {
    ok: true,
    cursor: { eventAt, kind: kind as TimelineEventKind, eventId: eventId.toLowerCase() },
  };
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
