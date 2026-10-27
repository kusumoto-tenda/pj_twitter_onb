import type postgres from 'postgres';
import type {
  TimelinePageRequest,
  TimelineQuery,
} from '@/application/timeline/ports/timeline-query';
import type { TimelineCursor, TimelinePage } from '@/application/timeline/timeline';
import { KIND_ORDER, UTC_MICROS, toTimelineItem, withImages } from './timeline-rows';

/** 投稿とリツイートをUNION ALLで1つの出来事の列にし、キーセットでページングする。 */
export class PostgresTimelineQuery implements TimelineQuery {
  constructor(private readonly sql: postgres.Sql) {}

  async findPage({ followingOnly, viewerId, after, limit }: TimelinePageRequest): Promise<TimelinePage> {
    const sql = this.sql;
    // 次ページの有無を判定するため1件多く取得する。
    const fetchSize = limit + 1;

    // フォロー一覧では、出来事の実行者がフォロー中の利用者であるものだけにする（本人の出来事は含めない）。
    const byActor = (actorColumn: postgres.PendingQuery<postgres.Row[]>) =>
      followingOnly && viewerId
        ? sql`AND EXISTS (
            SELECT 1 FROM twitter.follows f
            WHERE f.follower_id = ${viewerId}::uuid AND f.follow_id = ${actorColumn}
          )`
        : sql``;
    const olderThan = (
      at: postgres.PendingQuery<postgres.Row[]>,
      kind: number,
      id: postgres.PendingQuery<postgres.Row[]>,
    ) =>
      after
        ? // timestamptz型のパラメータはpostgres.jsがDate（ミリ秒精度）に変換するため、文字列で渡して変換する。
          sql`AND (${at}, ${kind}::int, ${id}) < (
            ${after.eventAt}::text::timestamptz, ${KIND_ORDER[after.kind]}::int, ${after.eventId}::uuid
          )`
        : sql``;

    const page = sql`
      SELECT * FROM (
        (
          SELECT
            to_char(t.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS event_at,
            t.created_at AS event_at_value,
            0 AS kind,
            t.id AS event_id,
            t.id AS tweet_id,
            t.content,
            to_char(t.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS tweet_created_at,
            author.id AS author_id,
            author.name AS author_name,
            author.display_id AS author_display_id,
            NULL::uuid AS retweeter_id,
            NULL::text AS retweeter_name,
            NULL::text AS retweeter_display_id
          FROM twitter.tweets t
          JOIN twitter.users author ON author.id = t.owner_id
          WHERE TRUE
            ${byActor(sql`t.owner_id`)}
            ${olderThan(sql`t.created_at`, KIND_ORDER.tweet, sql`t.id`)}
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT ${fetchSize}
        )
        UNION ALL
        (
          SELECT
            to_char(r.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}),
            r.created_at,
            1,
            r.id,
            t.id,
            t.content,
            to_char(t.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}),
            author.id,
            author.name,
            author.display_id,
            retweeter.id,
            retweeter.name,
            retweeter.display_id
          FROM twitter.retweets r
          JOIN twitter.tweets t ON t.id = r.tweet_id
          JOIN twitter.users author ON author.id = t.owner_id
          JOIN twitter.users retweeter ON retweeter.id = r.executor_id
          WHERE TRUE
            ${byActor(sql`r.executor_id`)}
            ${olderThan(sql`r.created_at`, KIND_ORDER.retweet, sql`r.id`)}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT ${fetchSize}
        )
      ) AS events
      ORDER BY event_at_value DESC, kind DESC, event_id DESC
      LIMIT ${fetchSize}
    `;
    const rows = await withImages(sql, page, sql`page.event_at_value DESC, page.kind DESC, page.event_id DESC`, viewerId);

    const items = rows.slice(0, limit).map(toTimelineItem);
    const nextCursor: TimelineCursor | null = rows.length > limit ? items[limit - 1].key : null;
    return { items, nextCursor };
  }
}
