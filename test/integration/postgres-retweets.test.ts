import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgresFavoriteQuery } from '@/infra/persistence/postgres/query_services/postgres-favorite-query';
import { PostgresProfileQuery } from '@/infra/persistence/postgres/query_services/postgres-profile-query';
import { PostgresTimelineQuery } from '@/infra/persistence/postgres/query_services/postgres-timeline-query';
import { PostgresLikeRepository } from '@/infra/persistence/postgres/repositories/postgres-like-repository';
import { PostgresRetweetRepository } from '@/infra/persistence/postgres/repositories/postgres-retweet-repository';
import { PostgresTweetDeleter } from '@/infra/persistence/postgres/repositories/postgres-tweet-deleter';
import { PostgresUserRepository } from '@/infra/persistence/postgres/repositories/postgres-user-repository';
import { MediaFixtures } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let fixtures: TimelineFixtures;
let media: MediaFixtures;
let retweets: PostgresRetweetRepository;
let timeline: PostgresTimelineQuery;
let profile: PostgresProfileQuery;

let year = 2490 + Math.floor(Math.random() * 40);
const at = (minute: number, micro = 0) =>
  `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.${String(micro).padStart(6, '0')}Z`;
// 実行日時。固定fixtureの日時より後にして、タイムラインの先頭側に出ることを確かめる。
const later = (month: number) => new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`);

beforeAll(async () => {
  sql = await connectTestDatabase();
  fixtures = new TimelineFixtures(sql);
  media = new MediaFixtures(sql);
  retweets = new PostgresRetweetRepository(sql);
  timeline = new PostgresTimelineQuery(sql);
  profile = new PostgresProfileQuery(sql);
});

afterEach(async () => {
  await fixtures.cleanup();
  await media.cleanup();
  year += 1;
});

afterAll(async () => {
  await sql.end();
});

const rowsOf = (userId: string) =>
  sql<{ id: string; tweet_id: string; created_at: Date }[]>`
    SELECT id, tweet_id, created_at FROM twitter.retweets WHERE executor_id = ${userId} ORDER BY created_at, id
  `;
const set = (actorId: string, tweetId: string, active: boolean, now = new Date()) =>
  retweets.set({ actorId, tweetId, active, id: randomUUID(), now });
const home = (viewerId: string | null, followingOnly = false) =>
  timeline.findPage({ followingOnly, viewerId, after: null, limit: 20 });

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PostgresRetweetRepository.set', () => {
  it('登録は冪等で、登録済みへの登録はUUID・日時を変えない。解除済みの解除も成功し、件数を読み返す', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const bob = await fixtures.user('ボブ', 'Rt');
    const tweet = await fixtures.tweet(bob, 'ボブの投稿', at(1));

    expect(await set(alice.id, tweet, true, later(1))).toEqual({ status: 'set', active: true, count: 1 });
    const [first] = await rowsOf(alice.id);
    expect(await set(alice.id, tweet, true, later(6))).toEqual({ status: 'set', active: true, count: 1 });
    expect(await rowsOf(alice.id)).toEqual([first]);
    // 自分の投稿のリツイートも許可し、件数に数える
    expect(await set(bob.id, tweet, true)).toEqual({ status: 'set', active: true, count: 2 });

    expect(await set(alice.id, tweet, false)).toEqual({ status: 'set', active: false, count: 1 });
    expect(await set(alice.id, tweet, false)).toEqual({ status: 'set', active: false, count: 1 });
    expect(await rowsOf(alice.id)).toEqual([]);
    // 他人の行は残る
    expect(await rowsOf(bob.id)).toHaveLength(1);
  });

  it('同じ登録の再送ではタイムラインの順位が上がらず、解除後の再実行は新しいUUID・日時で先頭側へ出る', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const bob = await fixtures.user('ボブ', 'Rt');
    // アリスとボブだけをフォローする読者の一覧で見て、共有テストDBの別fixtureを順位の期待値に混ぜない。
    const reader = await fixtures.user('読者', 'Rt');
    await fixtures.follow(reader, alice, at(0));
    await fixtures.follow(reader, bob, at(0));
    const target = await fixtures.tweet(bob, '対象', at(1));
    await set(alice.id, target, true, later(2));
    const newer = await fixtures.tweet(bob, '後の投稿', `${year}-03-01T00:00:00.000000Z`);
    const order = async () =>
      (await home(reader.id, true)).items.map((i) => [i.key.kind, i.tweet.id === target ? 'target' : i.tweet.id === newer ? 'newer' : '?']);
    expect(await order()).toEqual([['tweet', 'newer'], ['retweet', 'target'], ['tweet', 'target']]);
    const [before] = await rowsOf(alice.id);

    await set(alice.id, target, true, later(4));
    expect(await order()).toEqual([['tweet', 'newer'], ['retweet', 'target'], ['tweet', 'target']]);
    expect(await rowsOf(alice.id)).toEqual([before]);

    await set(alice.id, target, false);
    expect(await order()).toEqual([['tweet', 'newer'], ['tweet', 'target']]);
    await set(alice.id, target, true, later(5));
    const [after] = await rowsOf(alice.id);
    expect(after.id).not.toBe(before.id);
    expect(after.created_at.getTime()).toBeGreaterThan(before.created_at.getTime());
    expect(await order()).toEqual([['retweet', 'target'], ['tweet', 'newer'], ['tweet', 'target']]);
    // 元投稿の作成日時は変えない
    expect((await home(reader.id, true)).items[0].tweet.createdAt).toBe(at(1));
  });

  it('同じ登録を同時に送っても1行だけ作り、どの応答も同じ件数を返す', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const tweet = await fixtures.tweet(alice, '同時', at(1));

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => set(alice.id, tweet, true)));

    expect(outcomes).toEqual(Array.from({ length: 5 }, () => ({ status: 'set', active: true, count: 1 })));
    expect(await rowsOf(alice.id)).toHaveLength(1);
  });

  it('別々の利用者が同時に登録しても、件数は直列化されて最後は全員分になる', async () => {
    const owner = await fixtures.user('作者', 'Rt');
    const tweet = await fixtures.tweet(owner, '人気', at(1));
    const people = await Promise.all(Array.from({ length: 5 }, (_, i) => fixtures.user(`人${i}`, 'Rt')));

    const outcomes = await Promise.all(people.map((p) => set(p.id, tweet, true)));

    expect(outcomes.map((o) => (o.status === 'set' ? o.count : -1)).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('解除は自分の行だけを消し、他人のリツイートは残す', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const bob = await fixtures.user('ボブ', 'Rt');
    const tweet = await fixtures.tweet(alice, 'アリスの投稿', at(1));
    const bobRetweet = await fixtures.retweet(bob, tweet, at(2));

    // 作者でも他人のリツイートは解除できない
    expect(await set(alice.id, tweet, false)).toEqual({ status: 'set', active: false, count: 1 });
    expect(await sql`SELECT id FROM twitter.retweets WHERE id = ${bobRetweet}`).toHaveLength(1);
  });

  it('対象の投稿がなければtweet-not-found、利用者がいなければactor-not-foundで、行を作らない', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const tweet = await fixtures.tweet(alice, 'a', at(1));

    expect(await set(alice.id, randomUUID(), true)).toEqual({ status: 'tweet-not-found' });
    expect(await set(alice.id, randomUUID(), false)).toEqual({ status: 'tweet-not-found' });
    expect(await set(randomUUID(), tweet, true)).toEqual({ status: 'actor-not-found' });
    expect(await set(randomUUID(), tweet, false)).toEqual({ status: 'actor-not-found' });
    expect(await sql`SELECT 1 FROM twitter.retweets WHERE tweet_id = ${tweet}`).toHaveLength(0);
  });

  it('対象の削除と同時に登録しても、成功を装わずtweet-not-foundか削除後に消えた状態になる', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    for (let i = 0; i < 3; i += 1) {
      const tweet = await fixtures.tweet(alice, `競合${i}`, at(i));
      const [outcome, deleted] = await Promise.all([
        set(alice.id, tweet, true),
        new PostgresTweetDeleter(sql).deleteOwned({ actorId: alice.id, tweetId: tweet }),
      ]);
      expect(deleted).toBe('deleted');
      expect([{ status: 'set', active: true, count: 1 }, { status: 'tweet-not-found' }]).toContainEqual(outcome);
      expect(await sql`SELECT 1 FROM twitter.retweets WHERE tweet_id = ${tweet}`).toHaveLength(0);
    }
  });

  it('リツイートで元投稿の本文・日時・revision・画像、お気に入り・いいねを変えない', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const bob = await fixtures.user('ボブ', 'Rt');
    const draftId = await media.draft(alice.id, new Date());
    const upload = await media.verified(alice.id, draftId, new Date());
    await media.writer.publish({ actorId: alice.id, draftId, value: { content: '画像', uploadIds: [upload.uploadId] }, fingerprint: 'c', now: new Date() });
    await fixtures.favorite(bob, draftId, at(1));
    await fixtures.like(bob, draftId, at(2));
    const tweetOf = () => sql`SELECT content, created_at, updated_at, revision FROM twitter.tweets WHERE id = ${draftId}`;
    const imagesOf = () => sql`SELECT id, storage_key, position FROM twitter.images WHERE tweet_id = ${draftId}`;
    const reactionsOf = () => sql`
      SELECT 'favorite' AS kind, id, created_at FROM twitter.favorites WHERE tweet_id = ${draftId}
      UNION ALL SELECT 'like', id, created_at FROM twitter.likes WHERE tweet_id = ${draftId}
      ORDER BY kind
    `;
    const before = [await tweetOf(), await imagesOf(), await reactionsOf()];

    await set(bob.id, draftId, true);
    await set(bob.id, draftId, false);
    await set(alice.id, draftId, true);

    expect([await tweetOf(), await imagesOf(), await reactionsOf()]).toEqual(before);
    expect(await sql`SELECT 1 FROM twitter.media_delete_jobs WHERE storage_key = ${upload.storageKey}`).toHaveLength(0);
  });

  it('いいねの操作でリツイートの行・件数を変えない', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const tweet = await fixtures.tweet(alice, '独立', at(1));
    await set(alice.id, tweet, true);
    const before = await rowsOf(alice.id);
    const likes = new PostgresLikeRepository(sql);

    await likes.set({ actorId: alice.id, tweetId: tweet, active: true, id: randomUUID(), now: new Date() });
    await likes.set({ actorId: alice.id, tweetId: tweet, active: false, id: randomUUID(), now: new Date() });

    expect(await rowsOf(alice.id)).toEqual(before);
    expect(await sql`SELECT 1 FROM twitter.likes WHERE tweet_id = ${tweet}`).toHaveLength(0);
  });

  it('無関係なDBエラーは成功扱いせずthrowする', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    await expect(retweets.set({ actorId: alice.id, tweetId: 'not-a-uuid', active: true, id: randomUUID(), now: new Date() })).rejects.toThrow();
    const broken = postgres('postgres://nobody:nothing@127.0.0.1:1/none', { connect_timeout: 1, max: 1 });
    try {
      await expect(new PostgresRetweetRepository(broken).set({ actorId: alice.id, tweetId: randomUUID(), active: true, id: randomUUID(), now: new Date() })).rejects.toThrow();
    } finally {
      await broken.end({ timeout: 0 });
    }
  });
});

describe('PostgresRetweetRepository account deletion concurrency', () => {
  it('自分の投稿のリツイートが利用者ロックを待つ間に退会しても、デッドロックせずactor-not-foundになる', async () => {
    const actor = await fixtures.user('退会とリツイート', 'Rc');
    const tweetId = await fixtures.tweet(actor, '本人の投稿', at(1));
    const actorLocked = signal<number>();
    const allowDelete = signal<void>();

    // 退会側が利用者のロックを先に持つ。リツイートがこのロックを待ったことを確認するまでDELETEしない。
    const deleting = sql.begin(async (tx) => {
      // 誤ったロック順でもテスト接続を無期限に残さない。成功の同期にはタイマーを使わない。
      await tx`SET LOCAL statement_timeout = '15s'`;
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM twitter.users WHERE id = ${actor.id} FOR UPDATE`;
      actorLocked.resolve(pid);
      await allowDelete.promise;
      return new PostgresUserRepository(tx).deleteById(actor.id);
    });
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
      const retweeting = set(actor.id, tweetId, true);
      const outcomes = Promise.allSettled([deleting, retweeting]);
      pending = outcomes;

      // 待ち時間ではなくDBの実際の待機関係で順序を固定する。
      await expect.poll(async () => {
        const rows = await sql<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity WHERE ${blockerPid}::int = ANY(pg_blocking_pids(pid))
        `;
        return rows.length;
      }, { timeout: 10_000, interval: 50 }).toBe(1);

      // 正しい順序（利用者→投稿）では、リツイートはまだ投稿をロックしていないのでCASCADEがそのまま完了する。
      allowDelete.resolve();
      const [deleted, retweeted] = await outcomes;
      expect(deleted).toEqual({ status: 'fulfilled', value: 'deleted' });
      expect(retweeted).toEqual({ status: 'fulfilled', value: { status: 'actor-not-found' } });
      expect(await sql`SELECT id FROM twitter.tweets WHERE id = ${tweetId}`).toHaveLength(0);
      expect(await sql`SELECT id FROM twitter.retweets WHERE executor_id = ${actor.id} OR tweet_id = ${tweetId}`).toHaveLength(0);
    } finally {
      allowDelete.resolve();
      await deletionResult;
      await pending;
    }
  });

  it('元投稿をロック中の削除を待つリツイートは、削除の確定後にtweet-not-foundになり行を残さない', async () => {
    const owner = await fixtures.user('作者', 'Rc');
    const actor = await fixtures.user('実行者', 'Rc');
    const tweetId = await fixtures.tweet(owner, '消える投稿', at(1));
    const tweetLocked = signal<number>();
    const allowDelete = signal<void>();

    const deleting = sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '15s'`;
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM twitter.tweets WHERE id = ${tweetId} FOR UPDATE`;
      tweetLocked.resolve(pid);
      await allowDelete.promise;
      await tx`DELETE FROM twitter.tweets WHERE id = ${tweetId}`;
    });
    const deletionResult = Promise.allSettled([deleting]);
    let pending: Promise<unknown> | undefined;
    try {
      const blockerPid = await Promise.race([
        tweetLocked.promise,
        deletionResult.then(([result]) => {
          if (result.status === 'rejected') throw result.reason;
          throw new Error('投稿のロック取得前に削除処理が終了しました');
        }),
      ]);
      const retweeting = set(actor.id, tweetId, true);
      const outcomes = Promise.allSettled([deleting, retweeting]);
      pending = outcomes;

      await expect.poll(async () => {
        const rows = await sql<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity WHERE ${blockerPid}::int = ANY(pg_blocking_pids(pid))
        `;
        return rows.length;
      }, { timeout: 10_000, interval: 50 }).toBe(1);

      allowDelete.resolve();
      const [deleted, retweeted] = await outcomes;
      expect(deleted.status).toBe('fulfilled');
      expect(retweeted).toEqual({ status: 'fulfilled', value: { status: 'tweet-not-found' } });
      expect(await sql`SELECT id FROM twitter.retweets WHERE tweet_id = ${tweetId}`).toHaveLength(0);
    } finally {
      allowDelete.resolve();
      await deletionResult;
      await pending;
    }
  });
});

describe('タイムライン・プロフィール・お気に入りのretweetedByViewer / retweetCount', () => {
  it('件数は公開、本人状態は閲覧者だけtrue。リツイートカードでも元投稿の値になり、いいね・画像と掛け合わせない', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const bob = await fixtures.user('ボブ', 'Rt');
    const carol = await fixtures.user('キャロル', 'Rt');
    const tweet = await fixtures.tweet(bob, 'ボブの投稿', at(1));
    const other = await fixtures.tweet(bob, 'リツイートされていない投稿', at(2));
    await fixtures.retweet(alice, tweet, at(3));
    await fixtures.retweet(carol, tweet, at(4));
    for (const person of [alice, bob, carol]) await fixtures.like(person, tweet, at(5));
    const states = (items: { key: { kind: string }; tweet: { id: string; retweetedByViewer: boolean; retweetCount: number; likeCount: number } }[]) =>
      items
        .filter((i) => [tweet, other].includes(i.tweet.id))
        .map((i) => [i.key.kind, i.tweet.id === tweet ? 'rt' : 'other', i.tweet.retweetedByViewer, i.tweet.retweetCount, i.tweet.likeCount]);

    expect(states((await home(alice.id)).items)).toEqual([
      ['retweet', 'rt', true, 2, 3],
      ['retweet', 'rt', true, 2, 3],
      ['tweet', 'other', false, 0, 0],
      ['tweet', 'rt', true, 2, 3],
    ]);
    expect(states((await home(null)).items)).toEqual([
      ['retweet', 'rt', false, 2, 3],
      ['retweet', 'rt', false, 2, 3],
      ['tweet', 'other', false, 0, 0],
      ['tweet', 'rt', false, 2, 3],
    ]);
    // ボブのプロフィールをアリスが見る（対象者はボブ、閲覧者はアリス）
    const bobsTweets = await profile.findActivityPage({ subjectId: bob.id, viewerId: alice.id, kind: 'tweet', after: null, limit: 20 });
    expect(states(bobsTweets.items)).toEqual([
      ['tweet', 'other', false, 0, 0],
      ['tweet', 'rt', true, 2, 3],
    ]);
    // キャロルのリツイートタブをボブが見る（ボブ自身はリツイートしていない）
    const carolsRetweets = await profile.findActivityPage({ subjectId: carol.id, viewerId: bob.id, kind: 'retweet', after: null, limit: 20 });
    expect(states(carolsRetweets.items)).toEqual([['retweet', 'rt', false, 2, 3]]);
    // 公開いいね一覧も同じ値を持つ
    const bobsLikes = await profile.findLikedPage({ subjectId: bob.id, viewerId: alice.id, after: null, limit: 20 });
    expect(bobsLikes.items.map((e) => [e.item.tweet.retweetedByViewer, e.item.tweet.retweetCount])).toEqual([[true, 2]]);
    await fixtures.favorite(alice, tweet, at(6));
    const saved = await new PostgresFavoriteQuery(sql).findPage({ actorId: alice.id, after: null, limit: 20 });
    expect(saved.items[0].item.tweet).toMatchObject({ retweetedByViewer: true, retweetCount: 2, likeCount: 3, favoritedByViewer: true });
  });

  it('フォローのみでは実行者で判定し、自分のリツイートは出さない', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const bob = await fixtures.user('ボブ', 'Rt');
    const carol = await fixtures.user('キャロル', 'Rt');
    const carolTweet = await fixtures.tweet(carol, 'キャロルの投稿', at(1));
    await fixtures.follow(alice, bob);
    await set(bob.id, carolTweet, true, later(2));
    await set(alice.id, carolTweet, true, later(3));

    const items = (await home(alice.id, true)).items.filter((i) => i.tweet.id === carolTweet);
    expect(items.map((i) => [i.key.kind, i.retweetedBy?.id])).toEqual([['retweet', bob.id]]);
    expect(items.map((i) => [i.tweet.retweetedByViewer, i.tweet.retweetCount])).toEqual([[true, 2]]);
  });

  it('リツイートした人の退会でその人のリツイートだけが消え、件数に反映される', async () => {
    const alice = await fixtures.user('アリス', 'Rt');
    const bob = await fixtures.user('ボブ', 'Rt');
    const carol = await fixtures.user('キャロル', 'Rt');
    const tweet = await fixtures.tweet(bob, 'ボブ', at(1));
    await fixtures.retweet(alice, tweet, at(2));
    await fixtures.retweet(carol, tweet, at(3));

    await new PostgresUserRepository(sql).deleteById(carol.id);

    const items = (await home(alice.id)).items.filter((i) => i.tweet.id === tweet);
    expect(items.map((i) => [i.key.kind, i.retweetedBy?.id ?? null, i.tweet.retweetCount])).toEqual([
      ['retweet', alice.id, 1],
      ['tweet', null, 1],
    ]);
  });
});
