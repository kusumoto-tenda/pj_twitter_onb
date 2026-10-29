import type postgres from 'postgres';
import type { ProfileQuery } from '@/application/query_service_ifs/profile/profile-query';
import type {
  ConnectionCursor,
  ConnectionDirection,
  ConnectionPage,
  LikeCursor,
  ProfileLikesPage,
  ProfileSummary,
} from '@/application/dtos/profile/profile';
import type {
  TimelineCursor,
  TimelineEventKind,
  TimelinePage,
} from '@/application/dtos/timeline/timeline';
import { normalizeDisplayId } from '@/domain/value_objects/users/account-validation';
import { KIND_ORDER, UTC_MICROS, toTimelineItem, withImages, type EventRow } from './timeline-rows';

type SummaryRow = {
  id: string;
  name: string;
  display_id: string;
  bio: string;
  created_at: string;
  following_count: number;
  follower_count: number;
  followed_by_viewer: boolean;
};

type LikedRow = EventRow & { like_id: string; liked_at: string };

type ConnectionRow = {
  id: string;
  name: string;
  display_id: string;
  relation_created_at: string;
  relation_id: string;
};

/** プロフィール画面の読み取り。password_hashはSELECTしない。各ページは1回のSQLで取得する。 */
export class PostgresProfileQuery implements ProfileQuery {
  constructor(private readonly sql: postgres.Sql) {}

  async findSummary({
    displayId,
    viewerId,
  }: {
    displayId: string;
    viewerId: string | null;
  }): Promise<ProfileSummary | null> {
    // 件数は向きごとの独立したサブクエリで数え、JOINによる掛け合わせを避ける。
    const rows = await this.sql<SummaryRow[]>`
      SELECT
        u.id,
        u.name,
        u.display_id,
        u.bio,
        to_char(u.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS created_at,
        (SELECT count(*) FROM twitter.follows f WHERE f.follower_id = u.id)::int AS following_count,
        (SELECT count(*) FROM twitter.follows f WHERE f.follow_id = u.id)::int AS follower_count,
        (${viewerId}::uuid IS NOT NULL AND EXISTS (
          SELECT 1 FROM twitter.follows f
          WHERE f.follower_id = ${viewerId}::uuid AND f.follow_id = u.id
        )) AS followed_by_viewer
      FROM twitter.users u
      WHERE lower(u.display_id) = ${normalizeDisplayId(displayId)}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      displayId: row.display_id,
      bio: row.bio,
      createdAt: row.created_at,
      followingCount: Number(row.following_count),
      followerCount: Number(row.follower_count),
      followedByViewer: row.followed_by_viewer,
    };
  }

  async findActivityPage({
    subjectId,
    viewerId,
    kind,
    after,
    limit,
  }: {
    subjectId: string;
    viewerId: string | null;
    kind: TimelineEventKind;
    after: TimelineCursor | null;
    limit: number;
  }): Promise<TimelinePage> {
    const sql = this.sql;
    const olderThan = (
      at: postgres.PendingQuery<postgres.Row[]>,
      id: postgres.PendingQuery<postgres.Row[]>,
    ) =>
      after
        ? sql`AND (${at}, ${KIND_ORDER[kind]}::int, ${id}) < (
            ${after.eventAt}::text::timestamptz, ${KIND_ORDER[after.kind]}::int, ${after.eventId}::uuid
          )`
        : sql``;

    // 種類ごとに固定のSQLを選ぶ。クライアント由来の値を識別子として連結しない。
    const page =
      kind === 'tweet'
        ? sql`
            SELECT
              t.created_at AS sort_at,
              to_char(t.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS event_at,
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
            WHERE t.owner_id = ${subjectId}::uuid
              ${olderThan(sql`t.created_at`, sql`t.id`)}
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT ${limit + 1}
          `
        : sql`
            SELECT
              r.created_at AS sort_at,
              to_char(r.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS event_at,
              1 AS kind,
              r.id AS event_id,
              t.id AS tweet_id,
              t.content,
              to_char(t.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS tweet_created_at,
              author.id AS author_id,
              author.name AS author_name,
              author.display_id AS author_display_id,
              retweeter.id AS retweeter_id,
              retweeter.name AS retweeter_name,
              retweeter.display_id AS retweeter_display_id
            FROM twitter.retweets r
            JOIN twitter.tweets t ON t.id = r.tweet_id
            JOIN twitter.users author ON author.id = t.owner_id
            JOIN twitter.users retweeter ON retweeter.id = r.executor_id
            WHERE r.executor_id = ${subjectId}::uuid
              ${olderThan(sql`r.created_at`, sql`r.id`)}
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT ${limit + 1}
          `;
    const rows = await withImages(sql, page, sql`page.sort_at DESC, page.event_id DESC`, viewerId);

    const items = rows.slice(0, limit).map(toTimelineItem);
    return { items, nextCursor: rows.length > limit ? items[limit - 1].key : null };
  }

  async findLikedPage({
    subjectId,
    viewerId,
    after,
    limit,
  }: {
    subjectId: string;
    viewerId: string | null;
    after: LikeCursor | null;
    limit: number;
  }): Promise<ProfileLikesPage> {
    const sql = this.sql;
    // 対象者のいいねでページを先に選び、画像・件数・本人状態はその後で集約する。
    const page = sql`
      SELECT
        l.created_at AS sort_at,
        l.id AS like_id,
        to_char(l.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS liked_at,
        to_char(t.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS event_at,
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
      FROM twitter.likes l
      JOIN twitter.tweets t ON t.id = l.tweet_id
      JOIN twitter.users author ON author.id = t.owner_id
      WHERE l.executor_id = ${subjectId}::uuid
        ${
          after
            ? // 境界の日時はマイクロ秒を保つため文字列で渡してDBで変換する。
              sql`AND (l.created_at, l.id) < (${after.createdAt}::text::timestamptz, ${after.likeId}::uuid)`
            : sql``
        }
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${limit + 1}
    `;
    // 本人状態（いいね・お気に入り）は閲覧者について判定する。対象者の保存状態は返さない。
    const rows = await withImages<LikedRow>(sql, page, sql`page.sort_at DESC, page.like_id DESC`, viewerId);
    const items = rows.slice(0, limit).map((row) => ({
      likeId: row.like_id,
      likedAt: row.liked_at,
      item: toTimelineItem(row),
    }));
    const last = items[limit - 1];
    return {
      items,
      nextCursor: rows.length > limit ? { createdAt: last.likedAt, likeId: last.likeId } : null,
    };
  }

  async findConnectionsPage({
    subjectId,
    direction,
    after,
    limit,
  }: {
    subjectId: string;
    direction: ConnectionDirection;
    after: ConnectionCursor | null;
    limit: number;
  }): Promise<ConnectionPage> {
    const sql = this.sql;
    // following: 対象者がフォローしている人（follow_id側）、followers: 対象者をフォローしている人（follower_id側）。
    const [subjectColumn, personColumn] =
      direction === 'following'
        ? [sql`f.follower_id`, sql`f.follow_id`]
        : [sql`f.follow_id`, sql`f.follower_id`];
    const olderThan = after
      ? sql`AND (f.created_at, f.id) < (${after.createdAt}::text::timestamptz, ${after.relationId}::uuid)`
      : sql``;

    const rows = await sql<ConnectionRow[]>`
      SELECT
        u.id,
        u.name,
        u.display_id,
        to_char(f.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS relation_created_at,
        f.id AS relation_id
      FROM twitter.follows f
      JOIN twitter.users u ON u.id = ${personColumn}
      WHERE ${subjectColumn} = ${subjectId}::uuid
        ${olderThan}
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${limit + 1}
    `;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({ id: row.id, name: row.name, displayId: row.display_id })),
      nextCursor:
        rows.length > limit && last
          ? { createdAt: last.relation_created_at, relationId: last.relation_id }
          : null,
    };
  }
}
