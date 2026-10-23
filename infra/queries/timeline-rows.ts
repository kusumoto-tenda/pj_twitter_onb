import type { TimelineEventKind, TimelineItem } from '@/application/timeline/timeline';

// 同時刻の並びを固定するため、DB内では種類を数値で比較する。
export const KIND_ORDER: Record<TimelineEventKind, number> = { tweet: 0, retweet: 1 };
const KIND_BY_ORDER: Record<number, TimelineEventKind> = { 0: 'tweet', 1: 'retweet' };

// マイクロ秒を保ったUTC文字列。JSのDateを経由するとページ境界がずれるため、比較用の値として使う。
// 境界値をSQLへ渡すときは `${value}::text::timestamptz` とする（postgres.jsのDate変換を避ける）。
export const UTC_MICROS = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** 投稿・リツイートの出来事1件分の行。 */
export type EventRow = {
  event_at: string;
  kind: number;
  event_id: string;
  tweet_id: string;
  content: string;
  tweet_created_at: string;
  author_id: string;
  author_name: string;
  author_display_id: string;
  retweeter_id: string | null;
  retweeter_name: string | null;
  retweeter_display_id: string | null;
};

export function toTimelineItem(row: EventRow): TimelineItem {
  return {
    key: { eventAt: row.event_at, kind: KIND_BY_ORDER[row.kind], eventId: row.event_id },
    tweet: {
      id: row.tweet_id,
      content: row.content,
      author: { id: row.author_id, name: row.author_name, displayId: row.author_display_id },
      createdAt: row.tweet_created_at,
    },
    retweetedBy:
      row.retweeter_id === null
        ? null
        : {
            id: row.retweeter_id,
            name: row.retweeter_name!,
            displayId: row.retweeter_display_id!,
          },
  };
}
