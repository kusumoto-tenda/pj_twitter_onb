import type postgres from 'postgres';
import type { TimelineEventKind, TimelineImage, TimelineItem } from '@/application/timeline/timeline';

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
  images: TimelineImage[];
  favorited_by_viewer: boolean;
  liked_by_viewer: boolean;
  like_count: number;
  retweeted_by_viewer: boolean;
  retweet_count: number;
};

/**
 * ページの行を選んだ後で、その投稿の画像を表示順の配列にまとめ、閲覧者のお気に入り・いいね・リツイートかと
 * 公開いいね・リツイート件数を求める。画像・お気に入り・いいね・リツイートを先にJOINしないので、ページの件数や
 * 件数の値が掛け合わさらず、カードごとの追加SQLも発行しない。
 * viewerIdはセッションで確認した閲覧者（プロフィールの対象者ではない）。未ログインならnull。
 */
export function withImages<Row extends EventRow = EventRow>(
  sql: postgres.Sql,
  page: postgres.PendingQuery<postgres.Row[]>,
  orderBy: postgres.PendingQuery<postgres.Row[]>,
  viewerId: string | null,
) {
  return sql<Row[]>`
    SELECT page.*,
      (${viewerId}::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM twitter.favorites fv WHERE fv.user_id = ${viewerId}::uuid AND fv.tweet_id = page.tweet_id
      )) AS favorited_by_viewer,
      (${viewerId}::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM twitter.likes lk WHERE lk.executor_id = ${viewerId}::uuid AND lk.tweet_id = page.tweet_id
      )) AS liked_by_viewer,
      (SELECT count(*) FROM twitter.likes lk WHERE lk.tweet_id = page.tweet_id)::int AS like_count,
      (${viewerId}::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM twitter.retweets rt WHERE rt.executor_id = ${viewerId}::uuid AND rt.tweet_id = page.tweet_id
      )) AS retweeted_by_viewer,
      (SELECT count(*) FROM twitter.retweets rt WHERE rt.tweet_id = page.tweet_id)::int AS retweet_count,
      COALESCE((
        SELECT json_agg(
          json_build_object('id', i.id, 'position', i.position, 'width', i.width, 'height', i.height)
          ORDER BY i.position
        )
        FROM twitter.images i WHERE i.tweet_id = page.tweet_id
      ), '[]'::json) AS images
    FROM (${page}) AS page
    ORDER BY ${orderBy}
  `;
}

export function toTimelineItem(row: EventRow): TimelineItem {
  return {
    key: { eventAt: row.event_at, kind: KIND_BY_ORDER[row.kind], eventId: row.event_id },
    tweet: {
      id: row.tweet_id,
      content: row.content,
      author: { id: row.author_id, name: row.author_name, displayId: row.author_display_id },
      createdAt: row.tweet_created_at,
      images: row.images.map(({ id, position, width, height }) => ({ id, position, width, height })),
      favoritedByViewer: row.favorited_by_viewer,
      likedByViewer: row.liked_by_viewer,
      likeCount: Number(row.like_count),
      retweetedByViewer: row.retweeted_by_viewer,
      retweetCount: Number(row.retweet_count),
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
