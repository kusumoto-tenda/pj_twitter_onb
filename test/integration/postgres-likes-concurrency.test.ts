import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgresLikeRepository } from '@/infra/repositories/postgres-like-repository';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let fixtures: TimelineFixtures;

beforeAll(async () => {
  sql = await connectTestDatabase();
  fixtures = new TimelineFixtures(sql);
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await sql.end();
});

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PostgresLikeRepository account deletion concurrency', () => {
  it('自分の投稿へのいいねが利用者ロックを待つ間に退会しても、デッドロックせずactor-not-foundになる', async () => {
    const actor = await fixtures.user('退会といいね', 'Lc');
    const tweetId = await fixtures.tweet(actor, '本人の投稿', '2026-10-27T00:00:00.000000Z');
    const actorLocked = signal<number>();
    const allowDelete = signal<void>();

    // 退会側が利用者のロックを先に持つ。いいねがこのロックを待ったことを確認するまでDELETEしない。
    const deleting = sql.begin(async (tx) => {
      // 誤ったロック順でもテスト接続を無期限に残さない。成功の同期にはタイマーを使わない。
      await tx`SET LOCAL statement_timeout = '15s'`;
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM twitter.users WHERE id = ${actor.id} FOR UPDATE`;
      actorLocked.resolve(pid);
      await allowDelete.promise;
      return new PostgresUserRepository(tx).deleteById(actor.id);
    });
    // 準備中のDB障害もすぐ伝え、未処理のPromise rejectionを残さない。
    const deletionResult = Promise.allSettled([deleting]);
    let pending: Promise<unknown> | undefined;
    try {
      const blockerPid = await Promise.race([
        actorLocked.promise,
        deletionResult.then(([result]) => {
          if (result.status === 'rejected') throw result.reason;
          throw new Error('利用者のロック取得前に退会処理が終了しました');
        }),
      ]);
      const liking = new PostgresLikeRepository(sql).set({
        actorId: actor.id,
        tweetId,
        active: true,
        id: randomUUID(),
        now: new Date(),
      });
      const outcomes = Promise.allSettled([deleting, liking]);
      pending = outcomes;

      // 待ち時間ではなくDBの実際の待機関係で順序を固定する。各fixtureのUUIDはこのテスト専用。
      await expect.poll(async () => {
        const rows = await sql<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
          WHERE ${blockerPid}::int = ANY(pg_blocking_pids(pid))
        `;
        return rows.length;
      }, { timeout: 10_000, interval: 50 }).toBe(1);

      // 正しい順序では、いいねはまだ投稿をロックしていないのでCASCADEもそのまま完了する。
      // 投稿→利用者に逆転すると、退会のCASCADEといいねのFK/利用者ロックが循環待ちになる。
      allowDelete.resolve();
      const [deleted, liked] = await outcomes;
      expect(deleted).toEqual({ status: 'fulfilled', value: 'deleted' });
      expect(liked).toEqual({ status: 'fulfilled', value: { status: 'actor-not-found' } });

      expect(await sql`SELECT id FROM twitter.users WHERE id = ${actor.id}`).toHaveLength(0);
      expect(await sql`SELECT id FROM twitter.tweets WHERE id = ${tweetId}`).toHaveLength(0);
      expect(await sql`SELECT id FROM twitter.likes WHERE executor_id = ${actor.id} OR tweet_id = ${tweetId}`).toHaveLength(0);
    } finally {
      // 待機関係の確認が失敗してもロックを解放し、全処理の終了後にfixtureを片付ける。
      allowDelete.resolve();
      await deletionResult;
      await pending;
    }
  });
});
