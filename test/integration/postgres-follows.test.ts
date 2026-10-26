import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgresProfileQuery } from '@/infra/queries/postgres-profile-query';
import { PostgresTimelineQuery } from '@/infra/queries/postgres-timeline-query';
import { PostgresFollowRepository } from '@/infra/repositories/postgres-follow-repository';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { connectTestDatabase, uniqueDisplayId } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let fixtures: TimelineFixtures;
let follows: PostgresFollowRepository;

beforeAll(async () => {
  sql = await connectTestDatabase();
  fixtures = new TimelineFixtures(sql);
  follows = new PostgresFollowRepository(sql);
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await sql.end();
});

const set = (actorId: string, targetId: string, active: boolean, now = new Date()) =>
  follows.set({ actorId, targetId, active, id: randomUUID(), now });
const relations = (a: string, b: string) => sql`
  SELECT id, follower_id, follow_id, created_at FROM twitter.follows
  WHERE (follower_id = ${a} AND follow_id = ${b}) OR (follower_id = ${b} AND follow_id = ${a})
  ORDER BY follower_id, follow_id
`;

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** 固定時間待つ代わりに、対象の接続に対する実際のロック待ちを確認する。 */
async function waitUntilBlocked(blockerPid: number, count: number, finished: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ pid: number }[]>`
      WITH RECURSIVE blocked(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE ${blockerPid}::int = ANY(pg_blocking_pids(pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT pid FROM blocked
    `;
    if (rows.length >= count) return;
    if (finished()) throw new Error('ロック待ちを確認する前にフォロー処理が終了しました');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`ロック待ちが${count}件になりませんでした`);
}

describe('PostgresFollowRepository.set', () => {
  it('登録・解除は冪等で、同じ登録のUUID・日時と逆方向の関係を維持する', async () => {
    const a = await fixtures.user('A', 'Fl');
    const b = await fixtures.user('B', 'Fl');
    const firstAt = new Date('2026-10-27T01:00:00Z');
    expect(await set(a.id, b.id, true, firstAt)).toEqual({ status: 'set', active: true });
    expect(await set(b.id, a.id, true)).toEqual({ status: 'set', active: true });
    const before = await relations(a.id, b.id);

    expect(await set(a.id, b.id, true, new Date('2026-10-28T01:00:00Z'))).toEqual({ status: 'set', active: true });
    expect(await relations(a.id, b.id)).toEqual(before);
    expect(await set(a.id, b.id, false)).toEqual({ status: 'set', active: false });
    expect(await set(a.id, b.id, false)).toEqual({ status: 'set', active: false });
    expect(await relations(a.id, b.id)).toEqual(before.filter((row) => row.follower_id === b.id));
  });

  it('解除後の再登録は新しい関係UUIDと日時になり、関係一覧の先頭へ出る', async () => {
    const a = await fixtures.user('A', 'Fl');
    const b = await fixtures.user('B', 'Fl');
    const c = await fixtures.user('C', 'Fl');
    await set(a.id, b.id, true, new Date('2026-10-27T01:00:00Z'));
    const [first] = await relations(a.id, b.id);
    await set(a.id, c.id, true, new Date('2026-10-27T02:00:00Z'));
    await set(a.id, b.id, false);
    await set(a.id, b.id, true, new Date('2026-10-27T03:00:00Z'));

    const [again] = await relations(a.id, b.id);
    expect(again.id).not.toBe(first.id);
    expect(again.created_at.getTime()).toBeGreaterThan(first.created_at.getTime());
    const page = await new PostgresProfileQuery(sql).findConnectionsPage({ subjectId: a.id, direction: 'following', after: null, limit: 20 });
    expect(page.items.map((person) => person.id)).toEqual([b.id, c.id]);
  });

  it.each([true, false])('active=%sでも、消えたactorとtargetを区別して関係を作らない', async (active) => {
    const a = await fixtures.user('A', 'Fl');
    const missing = randomUUID();
    expect(await set(missing, a.id, active)).toEqual({ status: 'actor-not-found' });
    expect(await set(a.id, missing, active)).toEqual({ status: 'target-not-found' });
    expect(await set(missing, randomUUID(), active)).toEqual({ status: 'actor-not-found' });
    expect(await relations(a.id, missing)).toEqual([]);
  });

  it('自己フォローのCHECK違反と無関係なSQLエラーは成功扱いしない', async () => {
    const a = await fixtures.user('A', 'Fl');
    await expect(set(a.id, a.id, true)).rejects.toMatchObject({ code: '23514', constraint_name: 'follows_no_self_follow' });
    await expect(set(a.id, 'not-a-uuid', true)).rejects.toMatchObject({ code: '22P02' });
    expect(await relations(a.id, a.id)).toEqual([]);
  });

  it('同じ向きの登録・解除を同時に送っても、関係が重複せず全要求が完了する', async () => {
    const a = await fixtures.user('A', 'Fl');
    const b = await fixtures.user('B', 'Fl');
    expect(await Promise.all(Array.from({ length: 4 }, () => set(a.id, b.id, true)))).toEqual(
      Array.from({ length: 4 }, () => ({ status: 'set', active: true })),
    );
    expect(await relations(a.id, b.id)).toHaveLength(1);
    expect(await Promise.all(Array.from({ length: 4 }, () => set(a.id, b.id, false)))).toEqual(
      Array.from({ length: 4 }, () => ({ status: 'set', active: false })),
    );
    expect(await relations(a.id, b.id)).toEqual([]);
  });

  it('相互フォローが同じ利用者ロックを待っても、UUID順で取得してデッドロックしない', async () => {
    const a = await fixtures.user('A', 'Fl');
    const b = await fixtures.user('B', 'Fl');
    const [firstId] = [a.id, b.id].sort();
    const locked = signal<number>();
    const release = signal<void>();
    const holding = sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '15s'`;
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM twitter.users WHERE id = ${firstId} FOR UPDATE`;
      locked.resolve(pid);
      await release.promise;
    });
    const held = Promise.allSettled([holding]);
    let pending: Promise<unknown> | undefined;
    try {
      const blockerPid = await Promise.race([locked.promise, held.then(([result]) => {
        if (result.status === 'rejected') throw result.reason;
        throw new Error('ブロッカーがロック取得前に終了しました');
      })]);
      let finished = false;
      const forward = set(a.id, b.id, true);
      const reverse = set(b.id, a.id, true);
      const outcomes = Promise.allSettled([forward, reverse]).then((result) => { finished = true; return result; });
      pending = outcomes;
      await waitUntilBlocked(blockerPid, 2, () => finished);
      release.resolve();

      expect(await outcomes).toEqual([
        { status: 'fulfilled', value: { status: 'set', active: true } },
        { status: 'fulfilled', value: { status: 'set', active: true } },
      ]);
      expect(await relations(a.id, b.id)).toHaveLength(2);
    } finally {
      release.resolve();
      await held;
      await pending;
    }
  });

  it.each(['actor', 'target'] as const)('%sの退会が先にロックしていた場合も、消失を区別し関係を残さない', async (deletedRole) => {
    const a = await fixtures.user('A', 'Fl');
    const b = await fixtures.user('B', 'Fl');
    const deletedId = deletedRole === 'actor' ? a.id : b.id;
    const locked = signal<number>();
    const proceed = signal<void>();
    const deleting = sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '15s'`;
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM twitter.users WHERE id = ${deletedId} FOR UPDATE`;
      locked.resolve(pid);
      await proceed.promise;
      return new PostgresUserRepository(tx).deleteById(deletedId);
    });
    const deletionResult = Promise.allSettled([deleting]);
    let pending: Promise<unknown> | undefined;
    try {
      const blockerPid = await Promise.race([locked.promise, deletionResult.then(([result]) => {
        if (result.status === 'rejected') throw result.reason;
        throw new Error('退会がロック取得前に終了しました');
      })]);
      let finished = false;
      const following = set(a.id, b.id, true).finally(() => { finished = true; });
      const outcomes = Promise.allSettled([deleting, following]);
      pending = outcomes;
      await waitUntilBlocked(blockerPid, 1, () => finished);
      proceed.resolve();

      expect(await outcomes).toEqual([
        { status: 'fulfilled', value: 'deleted' },
        { status: 'fulfilled', value: { status: `${deletedRole}-not-found` } },
      ]);
      expect(await relations(a.id, b.id)).toEqual([]);
    } finally {
      proceed.resolve();
      await deletionResult;
      await pending;
    }
  });

  it('退会のCASCADEで両方向の関係だけ消え、他人同士の関係は維持する', async () => {
    const a = await fixtures.user('A', 'Fl');
    const b = await fixtures.user('B', 'Fl');
    const c = await fixtures.user('C', 'Fl');
    await set(a.id, b.id, true);
    await set(b.id, a.id, true);
    await set(b.id, c.id, true);
    const keep = await relations(b.id, c.id);

    expect(await new PostgresUserRepository(sql).deleteById(a.id)).toBe('deleted');
    expect(await relations(a.id, b.id)).toEqual([]);
    expect(await relations(b.id, c.id)).toEqual(keep);
  });

  it('件数・両側の一覧・表示ID変更・実行者で絞るタイムラインへ同じ関係を反映する', async () => {
    const a = await fixtures.user('A', 'Fl');
    const b = await fixtures.user('B', 'Fl');
    const c = await fixtures.user('C', 'Fl');
    const own = await fixtures.tweet(a, '自分', '2026-10-27T01:00:00.000001Z');
    const followed = await fixtures.tweet(b, 'フォロー先', '2026-10-27T01:01:00.000001Z');
    const other = await fixtures.tweet(c, '未フォロー', '2026-10-27T01:02:00.000001Z');
    const byB = await fixtures.retweet(b, other, '2026-10-27T01:03:00.000001Z');
    await fixtures.retweet(c, followed, '2026-10-27T01:04:00.000001Z');
    const byA = await fixtures.retweet(a, other, '2026-10-27T01:05:00.000001Z');
    const profiles = new PostgresProfileQuery(sql);
    const timeline = new PostgresTimelineQuery(sql);
    const events = async () => (await timeline.findPage({ followingOnly: true, viewerId: a.id, after: null, limit: 20 })).items.map((item) => item.key.eventId);

    await set(a.id, b.id, true);
    expect(await profiles.findSummary({ displayId: a.displayId, viewerId: a.id })).toMatchObject({ followingCount: 1, followerCount: 0 });
    expect(await profiles.findSummary({ displayId: b.displayId, viewerId: a.id })).toMatchObject({ followingCount: 0, followerCount: 1, followedByViewer: true });
    expect((await profiles.findConnectionsPage({ subjectId: a.id, direction: 'following', after: null, limit: 20 })).items).toEqual([b]);
    expect((await profiles.findConnectionsPage({ subjectId: b.id, direction: 'followers', after: null, limit: 20 })).items).toEqual([a]);
    expect(await events()).toEqual([byA, byB, followed, own]);

    const newDisplayId = uniqueDisplayId('Fn');
    await new PostgresUserRepository(sql).updateProfile(b.id, { name: '改名B', displayId: newDisplayId, bio: '' });
    expect((await profiles.findConnectionsPage({ subjectId: a.id, direction: 'following', after: null, limit: 20 })).items).toEqual([{ ...b, name: '改名B', displayId: newDisplayId }]);
    await set(a.id, b.id, false);
    expect(await profiles.findSummary({ displayId: newDisplayId, viewerId: a.id })).toMatchObject({ followerCount: 0, followedByViewer: false });
    expect(await profiles.findSummary({ displayId: a.displayId, viewerId: a.id })).toMatchObject({ followingCount: 0 });
    expect((await profiles.findConnectionsPage({ subjectId: b.id, direction: 'followers', after: null, limit: 20 })).items).toEqual([]);
    expect(await events()).toEqual([byA, own]);
    // 解除は関係だけを消し、元投稿・自分と他人のリツイートを変更しない。
    expect(await sql`SELECT id FROM twitter.retweets WHERE id = ANY(${[byA, byB]}::uuid[])`).toHaveLength(2);
  });
});
