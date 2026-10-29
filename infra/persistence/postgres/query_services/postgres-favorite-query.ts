import type postgres from 'postgres';
import type { FavoritePage } from '@/application/dtos/favorites/favorite';
import type { FavoriteQuery } from '@/application/query_service_ifs/favorites/favorite-query';
import { UTC_MICROS, toTimelineItem, withImages, type EventRow } from './timeline-rows';

type FavoriteRow = EventRow & { favorite_id: string; favorited_at: string };

/** 本人のお気に入り一覧。保存した日時の降順で、元投稿の現在の内容を1ページ1回のSQLで取得する。 */
export class PostgresFavoriteQuery implements FavoriteQuery {
  constructor(private readonly sql: postgres.Sql) {}

  async findPage({ actorId, after, limit }: Parameters<FavoriteQuery['findPage']>[0]): Promise<FavoritePage> {
    const sql = this.sql;
    const page = sql`
      SELECT
        f.created_at AS sort_at,
        f.id AS favorite_id,
        to_char(f.created_at AT TIME ZONE 'UTC', ${UTC_MICROS}) AS favorited_at,
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
      FROM twitter.favorites f
      JOIN twitter.tweets t ON t.id = f.tweet_id
      JOIN twitter.users author ON author.id = t.owner_id
      WHERE f.user_id = ${actorId}::uuid
        ${
          after
            ? // 境界の日時はマイクロ秒を保つため文字列で渡してDBで変換する。
              sql`AND (f.created_at, f.id) < (${after.createdAt}::text::timestamptz, ${after.favoriteId}::uuid)`
            : sql``
        }
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${limit + 1}
    `;
    // 閲覧者は本人なので、お気に入りの判定も本人のUUIDで行う（常にtrueになる）。
    const rows = await withImages<FavoriteRow>(sql, page, sql`page.sort_at DESC, page.favorite_id DESC`, actorId);
    const items = rows.slice(0, limit).map((row) => ({
      favoriteId: row.favorite_id,
      favoritedAt: row.favorited_at,
      item: toTimelineItem(row),
    }));
    const last = items[limit - 1];
    return {
      items,
      nextCursor: rows.length > limit ? { createdAt: last.favoritedAt, favoriteId: last.favoriteId } : null,
    };
  }
}
