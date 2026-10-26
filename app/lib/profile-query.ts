import type {
  ActivityTab,
  ConnectionCursor,
  ConnectionDirection,
  LikeCursor,
  ProfileTab,
} from '@/application/profile/profile';
import type { TimelineCursor } from '@/application/timeline/timeline';
import {
  decodeCursorParts,
  encodeCursorParts,
  isUtcMicros,
  isUuid,
  type SearchParamValue,
} from './cursor-validation';
import { toTimelineCursor } from './timeline-query';

const OTHER_TABS: readonly ProfileTab[] = ['retweets', 'following', 'followers'];
const KIND_BY_TAB = { tweets: 'tweet', retweets: 'retweet' } as const;
const LIKES_TAB = 'likes';

/** 単一の既知の値だけを受け付け、それ以外（未知・重複）は投稿タブにする。 */
export function parseProfileTab(value: SearchParamValue): ProfileTab {
  return typeof value === 'string' && OTHER_TABS.includes(value as ProfileTab)
    ? (value as ProfileTab)
    : 'tweets';
}

/**
 * カーソルは対象者とタブに結び付けてエンコードする。
 * 他のタブや他人のページへ持ち込まれた場合は不正として扱う（認証には使わない）。
 */
export function encodeActivityCursor(
  subjectId: string,
  tab: ActivityTab,
  cursor: TimelineCursor,
): string {
  return encodeCursorParts([subjectId, tab, cursor.eventAt, cursor.kind, cursor.eventId]);
}

export function encodeConnectionCursor(
  subjectId: string,
  tab: ConnectionDirection,
  cursor: ConnectionCursor,
): string {
  return encodeCursorParts([subjectId, tab, cursor.createdAt, cursor.relationId]);
}

/** 公開いいね一覧のカーソル。対象者とlikesタブに結び付ける（投稿・リツイートのカーソルとは混ぜない）。 */
export function encodeLikeCursor(subjectId: string, cursor: LikeCursor): string {
  return encodeCursorParts([subjectId, LIKES_TAB, cursor.createdAt, cursor.likeId]);
}

function belongsTo(parts: unknown[], subjectId: string, tab: ProfileTab | typeof LIKES_TAB): boolean {
  return (
    isUuid(parts[0]) && parts[0].toLowerCase() === subjectId.toLowerCase() && parts[1] === tab
  );
}

export function parseActivityCursor(
  value: SearchParamValue,
  subjectId: string,
  tab: ActivityTab,
): { ok: true; cursor: TimelineCursor | null } | { ok: false } {
  const parts = decodeCursorParts(value, 5);
  if (parts === null) return { ok: true, cursor: null };
  if (parts === undefined || !belongsTo(parts, subjectId, tab)) return { ok: false };
  const cursor = toTimelineCursor(parts[2], parts[3], parts[4]);
  if (!cursor || cursor.kind !== KIND_BY_TAB[tab]) return { ok: false };
  return { ok: true, cursor };
}

export function parseConnectionCursor(
  value: SearchParamValue,
  subjectId: string,
  tab: ConnectionDirection,
): { ok: true; cursor: ConnectionCursor | null } | { ok: false } {
  const parts = decodeCursorParts(value, 4);
  if (parts === null) return { ok: true, cursor: null };
  if (parts === undefined || !belongsTo(parts, subjectId, tab)) return { ok: false };
  const [, , createdAt, relationId] = parts;
  if (!isUtcMicros(createdAt) || !isUuid(relationId)) return { ok: false };
  return { ok: true, cursor: { createdAt, relationId: relationId.toLowerCase() } };
}

export function parseLikeCursor(
  value: SearchParamValue,
  subjectId: string,
): { ok: true; cursor: LikeCursor | null } | { ok: false } {
  const parts = decodeCursorParts(value, 4);
  if (parts === null) return { ok: true, cursor: null };
  if (parts === undefined || !belongsTo(parts, subjectId, LIKES_TAB)) return { ok: false };
  const [, , createdAt, likeId] = parts;
  if (!isUtcMicros(createdAt) || !isUuid(likeId)) return { ok: false };
  return { ok: true, cursor: { createdAt, likeId: likeId.toLowerCase() } };
}

/** プロフィールのURL。投稿タブはtabを付けず、カーソルは指定時だけ付ける。 */
export function profileHref({
  displayId,
  tab,
  cursor = null,
}: {
  displayId: string;
  tab: ProfileTab;
  /** encodeActivityCursor / encodeConnectionCursor の結果。 */
  cursor?: string | null;
}): string {
  const params = new URLSearchParams();
  if (tab !== 'tweets') params.set('tab', tab);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  const path = `/profile/${encodeURIComponent(displayId)}`;
  return query ? `${path}?${query}` : path;
}
