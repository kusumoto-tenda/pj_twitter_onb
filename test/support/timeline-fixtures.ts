import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { uniqueDisplayId } from './test-db';

/**
 * タイムライン用のデータをSQLで直接作るfixture（未実装の投稿UIに依存しない）。
 * 作成した利用者だけを削除し、投稿・フォロー・リツイート・お気に入り・いいねはcascadeで消える。
 * PlaywrightのCJS変換でも読めるよう、import.meta.urlを使うモジュールは読まない。
 * 時刻はマイクロ秒まで保つため、postgres.jsのDate変換を避けて文字列からDBで変換する。
 */
export class TimelineFixtures {
  private readonly userIds: string[] = [];

  constructor(private readonly sql: postgres.Sql) {}

  async user(
    name = 'タイムライン太郎',
    prefix = 'Tl',
    { bio = '', createdAt }: { bio?: string; createdAt?: string } = {},
  ): Promise<TimelinePerson> {
    const person = { id: randomUUID(), name, displayId: uniqueDisplayId(prefix) };
    this.userIds.push(person.id);
    await this.sql`
      INSERT INTO twitter.users (id, name, display_id, bio, password_hash, created_at)
      VALUES (
        ${person.id}, ${person.name}, ${person.displayId}, ${bio}, 'fixture-hash',
        COALESCE(${createdAt ?? null}::text::timestamptz, now())
      )
    `;
    return person;
  }

  /** 別の手段で作った利用者を後片付けの対象に加える。 */
  track(person: TimelinePerson): TimelinePerson {
    this.userIds.push(person.id);
    return person;
  }

  async tweet(
    owner: TimelinePerson,
    content: string,
    createdAt: string,
    updatedAt: string = createdAt,
  ): Promise<string> {
    const id = randomUUID();
    // 本文の遅延制約はコミット時に検査される。postgres.jsの自動コミットではその失敗が呼び出し元に
    // 返らないため、明示的なトランザクションで実行してエラーを受け取る。
    await this.sql.begin(
      (tx) => tx`
        INSERT INTO twitter.tweets (id, owner_id, content, created_at, updated_at)
        VALUES (${id}, ${owner.id}, ${content}, ${createdAt}::text::timestamptz, ${updatedAt}::text::timestamptz)
      `,
    );
    return id;
  }

  /** 同じ利用者の投稿をまとめて作る。 */
  async tweets(
    owner: TimelinePerson,
    items: { content: string; createdAt: string; id?: string }[],
  ): Promise<string[]> {
    const rows = items.map((item) => ({
      id: item.id ?? randomUUID(),
      owner_id: owner.id,
      content: item.content,
      created_at: item.createdAt,
      updated_at: item.createdAt,
    }));
    // JSONで渡し、マイクロ秒の時刻を文字列のままDBで変換する。
    await this.sql.begin(
      (tx) => tx`
      INSERT INTO twitter.tweets (id, owner_id, content, created_at, updated_at)
      SELECT id, owner_id, content, created_at, updated_at
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) AS x(
        id uuid, owner_id uuid, content text, created_at timestamptz, updated_at timestamptz
      )
    `,
    );
    return rows.map((row) => row.id);
  }

  async follow(
    follower: TimelinePerson,
    followee: TimelinePerson,
    createdAt?: string,
    id: string = randomUUID(),
  ): Promise<string> {
    await this.sql`
      INSERT INTO twitter.follows (id, follower_id, follow_id, created_at)
      VALUES (
        ${id}, ${follower.id}, ${followee.id},
        COALESCE(${createdAt ?? null}::text::timestamptz, now())
      )
    `;
    return id;
  }

  async retweet(
    executor: TimelinePerson,
    tweetId: string,
    createdAt: string,
    id: string = randomUUID(),
  ): Promise<string> {
    await this.sql`
      INSERT INTO twitter.retweets (id, executor_id, tweet_id, created_at)
      VALUES (${id}, ${executor.id}, ${tweetId}, ${createdAt}::text::timestamptz)
    `;
    return id;
  }

  /** お気に入りを直接作る（日時はマイクロ秒まで保つ）。 */
  async favorite(
    user: TimelinePerson,
    tweetId: string,
    createdAt: string,
    id: string = randomUUID(),
  ): Promise<string> {
    await this.sql`
      INSERT INTO twitter.favorites (id, user_id, tweet_id, created_at)
      VALUES (${id}, ${user.id}, ${tweetId}, ${createdAt}::text::timestamptz)
    `;
    return id;
  }

  /** いいねを直接作る（日時はマイクロ秒まで保つ）。 */
  async like(
    executor: TimelinePerson,
    tweetId: string,
    createdAt: string,
    id: string = randomUUID(),
  ): Promise<string> {
    await this.sql`
      INSERT INTO twitter.likes (id, executor_id, tweet_id, created_at)
      VALUES (${id}, ${executor.id}, ${tweetId}, ${createdAt}::text::timestamptz)
    `;
    return id;
  }

  async cleanup(): Promise<void> {
    const ids = this.userIds.splice(0);
    if (ids.length > 0) await this.sql`DELETE FROM twitter.users WHERE id = ANY(${ids}::uuid[])`;
  }
}
