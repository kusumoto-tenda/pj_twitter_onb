import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgresProfileQuery } from '@/infra/queries/postgres-profile-query';
import { PostgresFavoriteQuery } from '@/infra/queries/postgres-favorite-query';
import { PostgresTimelineQuery } from '@/infra/queries/postgres-timeline-query';
import { PostgresFavoriteRepository } from '@/infra/repositories/postgres-favorite-repository';
import { PostgresTweetDeleter } from '@/infra/repositories/postgres-tweet-deleter';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { MediaFixtures, PNG_IMAGE } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let fixtures: TimelineFixtures;
let media: MediaFixtures;
let favorites: PostgresFavoriteRepository;
let query: PostgresFavoriteQuery;

let year = 2400 + Math.floor(Math.random() * 50);
const at = (minute: number, micro = 0) =>
  `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.${String(micro).padStart(6, '0')}Z`;

beforeAll(async () => {
  sql = await connectTestDatabase();
  fixtures = new TimelineFixtures(sql);
  media = new MediaFixtures(sql);
  favorites = new PostgresFavoriteRepository(sql);
  query = new PostgresFavoriteQuery(sql);
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
    SELECT id, tweet_id, created_at FROM twitter.favorites WHERE user_id = ${userId} ORDER BY created_at, id
  `;
const set = (actorId: string, tweetId: string, active: boolean, now = new Date()) =>
  favorites.set({ actorId, tweetId, active, id: randomUUID(), now });

describe('PostgresFavoriteRepository.set', () => {
  it('登録は冪等で、保存済みへの登録は保存日時とUUIDを変えない。解除済みへの解除も成功する', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const bob = await fixtures.user('ボブ', 'Fv');
    const tweet = await fixtures.tweet(bob, 'ボブの投稿', at(1));

    expect(await set(alice.id, tweet, true, new Date('2400-01-01T00:00:00Z'))).toEqual({ status: 'set', active: true });
    const [first] = await rowsOf(alice.id);
    expect(await set(alice.id, tweet, true, new Date('2400-06-01T00:00:00Z'))).toEqual({ status: 'set', active: true });
    expect(await rowsOf(alice.id)).toEqual([first]);

    expect(await set(alice.id, tweet, false)).toEqual({ status: 'set', active: false });
    expect(await set(alice.id, tweet, false)).toEqual({ status: 'set', active: false });
    expect(await rowsOf(alice.id)).toEqual([]);
  });

  it('解除後の再追加は新しいUUID・保存日時で作り直す', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const tweet = await fixtures.tweet(alice, '自分の投稿も保存できる', at(1));
    await set(alice.id, tweet, true, new Date('2400-01-01T00:00:00Z'));
    const [before] = await rowsOf(alice.id);

    await set(alice.id, tweet, false);
    await set(alice.id, tweet, true, new Date('2400-02-01T00:00:00Z'));

    const [after] = await rowsOf(alice.id);
    expect(after.id).not.toBe(before.id);
    expect(after.created_at.getTime()).toBeGreaterThan(before.created_at.getTime());
  });

  it('同じ登録を同時に送っても1行だけ作る', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const tweet = await fixtures.tweet(alice, '同時', at(1));

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => set(alice.id, tweet, true)));

    expect(outcomes.every((o) => o.status === 'set')).toBe(true);
    expect(await rowsOf(alice.id)).toHaveLength(1);
  });

  it('対象の投稿がなければtweet-not-found、利用者がいなければactor-not-foundで、行を作らない', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const tweet = await fixtures.tweet(alice, 'a', at(1));

    expect(await set(alice.id, randomUUID(), true)).toEqual({ status: 'tweet-not-found' });
    expect(await set(randomUUID(), tweet, true)).toEqual({ status: 'actor-not-found' });
    expect(await set(randomUUID(), tweet, false)).toEqual({ status: 'actor-not-found' });
    expect(await rowsOf(alice.id)).toEqual([]);
  });

  it('対象の削除と同時に登録しても、成功を装わずtweet-not-foundか削除後に消えた状態になる', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    for (let i = 0; i < 3; i += 1) {
      const tweet = await fixtures.tweet(alice, `競合${i}`, at(i));
      const [outcome, deleted] = await Promise.all([
        set(alice.id, tweet, true),
        new PostgresTweetDeleter(sql).deleteOwned({ actorId: alice.id, tweetId: tweet }),
      ]);
      expect(deleted).toBe('deleted');
      expect([{ status: 'set', active: true }, { status: 'tweet-not-found' }]).toContainEqual(outcome);
      expect((await rowsOf(alice.id)).filter((r) => r.tweet_id === tweet)).toEqual([]);
    }
  });

  it('無関係なDBエラーは成功扱いせずthrowする', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    await expect(favorites.set({ actorId: alice.id, tweetId: 'not-a-uuid', active: true, id: randomUUID(), now: new Date() })).rejects.toThrow();
    const broken = postgres('postgres://nobody:nothing@127.0.0.1:1/none', { connect_timeout: 1, max: 1 });
    try {
      await expect(new PostgresFavoriteRepository(broken).set({ actorId: alice.id, tweetId: randomUUID(), active: true, id: randomUUID(), now: new Date() })).rejects.toThrow();
    } finally {
      await broken.end({ timeout: 0 });
    }
  });
});

describe('PostgresFavoriteQuery.findPage', () => {
  it('本人の保存だけを保存日時の降順（同時刻はUUIDの降順）で、元投稿の現在の内容・画像と一緒に返す', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const bob = await fixtures.user('ボブ', 'Fv');
    const draftId = await media.draft(bob.id, new Date());
    const upload = await media.verified(bob.id, draftId, new Date(), { ...PNG_IMAGE, width: 77, height: 10 });
    await media.writer.publish({ actorId: bob.id, draftId, value: { content: '画像付き', uploadIds: [upload.uploadId] }, fingerprint: 'c', now: new Date() });
    const plain = await fixtures.tweet(bob, '元の本文', at(1));
    const [low, high] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    await fixtures.favorite(alice, plain, at(5, 1), low);
    await fixtures.favorite(alice, draftId, at(5, 1), high);
    await fixtures.favorite(bob, plain, at(9)); // 他人の保存は出さない
    await sql`UPDATE twitter.tweets SET content = '編集後の本文' WHERE id = ${plain}`;

    const page = await query.findPage({ actorId: alice.id, after: null, limit: 20 });

    expect(page.nextCursor).toBeNull();
    expect(page.items.map((e) => [e.favoriteId, e.favoritedAt])).toEqual([
      [high, at(5, 1)],
      [low, at(5, 1)],
    ]);
    expect(page.items[0].item).toMatchObject({
      tweet: { id: draftId, content: '画像付き', author: bob, images: [{ width: 77 }], favoritedByViewer: true },
      retweetedBy: null,
    });
    expect(page.items[1].item.tweet).toMatchObject({ id: plain, content: '編集後の本文', images: [] });
  });

  it('21件あれば20件と次のカーソルを返し、マイクロ秒の境界と同時刻を取りこぼさず重複させない', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const tweets = await fixtures.tweets(alice, Array.from({ length: 23 }, (_, i) => ({ content: `t${i}`, createdAt: at(1, i) })));
    // 最初の3件は同時刻、残りは1マイクロ秒ずつずらす
    for (const [i, tweet] of tweets.entries()) await fixtures.favorite(alice, tweet, at(10, Math.max(0, i - 2)));

    const first = await query.findPage({ actorId: alice.id, after: null, limit: 20 });
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual({ createdAt: first.items[19].favoritedAt, favoriteId: first.items[19].favoriteId });
    const second = await query.findPage({ actorId: alice.id, after: first.nextCursor, limit: 20 });

    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((e) => e.item.tweet.id);
    expect(new Set(all).size).toBe(23);
    expect(all.slice(0, 20)).toEqual([...tweets].reverse().slice(0, 20));
  });

  it('元投稿の削除・作者の退会で一覧から消え、自分の退会で自分の保存行も消える', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const bob = await fixtures.user('ボブ', 'Fv');
    const carol = await fixtures.user('キャロル', 'Fv');
    const bobTweet = await fixtures.tweet(bob, 'ボブ', at(1));
    const carolTweet = await fixtures.tweet(carol, 'キャロル', at(2));
    const aliceTweet = await fixtures.tweet(alice, 'アリス', at(3));
    await fixtures.favorite(alice, bobTweet, at(4));
    await fixtures.favorite(alice, carolTweet, at(5));
    await fixtures.favorite(alice, aliceTweet, at(6));
    const carolKeeps = await fixtures.favorite(carol, bobTweet, at(7));

    await new PostgresTweetDeleter(sql).deleteOwned({ actorId: alice.id, tweetId: aliceTweet });
    await new PostgresUserRepository(sql).deleteById(carol.id);
    expect((await query.findPage({ actorId: alice.id, after: null, limit: 20 })).items.map((e) => e.item.tweet.id)).toEqual([bobTweet]);
    // キャロル自身の保存は、キャロルの退会で消える
    expect(await sql`SELECT 1 FROM twitter.favorites WHERE id = ${carolKeeps}`).toHaveLength(0);

    await new PostgresUserRepository(sql).deleteById(alice.id);
    expect(await rowsOf(alice.id)).toEqual([]);
    expect(await sql`SELECT 1 FROM twitter.favorites WHERE tweet_id = ${bobTweet}`).toHaveLength(0);
  });
});

describe('タイムライン・プロフィールのfavoritedByViewer', () => {
  it('閲覧者本人の保存だけをtrueにし、匿名はfalse。プロフィールの対象者と閲覧者を取り違えない', async () => {
    const alice = await fixtures.user('アリス', 'Fv');
    const bob = await fixtures.user('ボブ', 'Fv');
    const tweet = await fixtures.tweet(bob, 'ボブの投稿', at(1));
    const other = await fixtures.tweet(bob, '保存していない投稿', at(2));
    await fixtures.retweet(alice, tweet, at(3));
    await fixtures.favorite(alice, tweet, at(4));
    const flags = (items: { key: { kind: string }; tweet: { id: string; favoritedByViewer: boolean } }[]) =>
      items.filter((i) => [tweet, other].includes(i.tweet.id)).map((i) => [i.key.kind, i.tweet.id === tweet ? 'saved' : 'other', i.tweet.favoritedByViewer]);
    const timeline = new PostgresTimelineQuery(sql);
    const profile = new PostgresProfileQuery(sql);

    const asAlice = await timeline.findPage({ followingOnly: false, viewerId: alice.id, after: null, limit: 20 });
    expect(flags(asAlice.items)).toEqual([
      ['retweet', 'saved', true],
      ['tweet', 'other', false],
      ['tweet', 'saved', true],
    ]);
    const anonymous = await timeline.findPage({ followingOnly: false, viewerId: null, after: null, limit: 20 });
    expect(flags(anonymous.items).every(([, , saved]) => saved === false)).toBe(true);
    // ボブのプロフィールをアリスが見る（対象者はボブ、閲覧者はアリス）
    const bobsTweets = await profile.findActivityPage({ subjectId: bob.id, viewerId: alice.id, kind: 'tweet', after: null, limit: 20 });
    expect(flags(bobsTweets.items)).toEqual([
      ['tweet', 'other', false],
      ['tweet', 'saved', true],
    ]);
    // ボブ本人が見ると、アリスの保存はfalse
    const asBob = await profile.findActivityPage({ subjectId: bob.id, viewerId: bob.id, kind: 'tweet', after: null, limit: 20 });
    expect(flags(asBob.items).every(([, , saved]) => saved === false)).toBe(true);
    const alicesRetweets = await profile.findActivityPage({ subjectId: alice.id, viewerId: alice.id, kind: 'retweet', after: null, limit: 20 });
    expect(flags(alicesRetweets.items)).toEqual([['retweet', 'saved', true]]);
  });
});
