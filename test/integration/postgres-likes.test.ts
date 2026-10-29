import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgresFavoriteQuery } from '@/infra/persistence/postgres/query_services/postgres-favorite-query';
import { PostgresProfileQuery } from '@/infra/persistence/postgres/query_services/postgres-profile-query';
import { PostgresTimelineQuery } from '@/infra/persistence/postgres/query_services/postgres-timeline-query';
import { PostgresFavoriteRepository } from '@/infra/persistence/postgres/repositories/postgres-favorite-repository';
import { PostgresLikeRepository } from '@/infra/persistence/postgres/repositories/postgres-like-repository';
import { PostgresTweetDeleter } from '@/infra/persistence/postgres/repositories/postgres-tweet-deleter';
import { PostgresUserRepository } from '@/infra/persistence/postgres/repositories/postgres-user-repository';
import { MediaFixtures, PNG_IMAGE } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let fixtures: TimelineFixtures;
let media: MediaFixtures;
let likes: PostgresLikeRepository;
let profile: PostgresProfileQuery;

let year = 2450 + Math.floor(Math.random() * 40);
const at = (minute: number, micro = 0) =>
  `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.${String(micro).padStart(6, '0')}Z`;

beforeAll(async () => {
  sql = await connectTestDatabase();
  fixtures = new TimelineFixtures(sql);
  media = new MediaFixtures(sql);
  likes = new PostgresLikeRepository(sql);
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
    SELECT id, tweet_id, created_at FROM twitter.likes WHERE executor_id = ${userId} ORDER BY created_at, id
  `;
const set = (actorId: string, tweetId: string, active: boolean, now = new Date()) =>
  likes.set({ actorId, tweetId, active, id: randomUUID(), now });
const liked = (subjectId: string, viewerId: string | null, after: Parameters<PostgresProfileQuery['findLikedPage']>[0]['after'] = null) =>
  profile.findLikedPage({ subjectId, viewerId, after, limit: 20 });

describe('PostgresLikeRepository.set', () => {
  it('登録は冪等で、登録済みへの登録はUUID・日時を変えない。解除済みの解除も成功し、件数を読み返す', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const bob = await fixtures.user('ボブ', 'Lk');
    const tweet = await fixtures.tweet(bob, 'ボブの投稿', at(1));

    expect(await set(alice.id, tweet, true, new Date('2450-01-01T00:00:00Z'))).toEqual({ status: 'set', active: true, count: 1 });
    const [first] = await rowsOf(alice.id);
    expect(await set(alice.id, tweet, true, new Date('2450-06-01T00:00:00Z'))).toEqual({ status: 'set', active: true, count: 1 });
    expect(await rowsOf(alice.id)).toEqual([first]);
    // 自分の投稿へのいいねも許可し、件数に数える
    expect(await set(bob.id, tweet, true)).toEqual({ status: 'set', active: true, count: 2 });

    expect(await set(alice.id, tweet, false)).toEqual({ status: 'set', active: false, count: 1 });
    expect(await set(alice.id, tweet, false)).toEqual({ status: 'set', active: false, count: 1 });
    expect(await rowsOf(alice.id)).toEqual([]);
    // 他人の行は残る
    expect(await rowsOf(bob.id)).toHaveLength(1);
  });

  it('解除後の再登録は新しいUUID・日時で作り直し、公開一覧の先頭側へ出る', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const bob = await fixtures.user('ボブ', 'Lk');
    const older = await fixtures.tweet(bob, '先にいいね', at(1));
    const newer = await fixtures.tweet(bob, '後でいいね', at(2));
    await set(alice.id, older, true, new Date('2450-01-01T00:00:00Z'));
    await set(alice.id, newer, true, new Date('2450-02-01T00:00:00Z'));
    const [before] = (await rowsOf(alice.id)).filter((r) => r.tweet_id === older);
    expect((await liked(alice.id, null)).items.map((e) => e.item.tweet.id)).toEqual([newer, older]);

    await set(alice.id, older, false);
    await set(alice.id, older, true, new Date('2450-03-01T00:00:00Z'));

    const [after] = (await rowsOf(alice.id)).filter((r) => r.tweet_id === older);
    expect(after.id).not.toBe(before.id);
    expect(after.created_at.getTime()).toBeGreaterThan(before.created_at.getTime());
    expect((await liked(alice.id, null)).items.map((e) => e.item.tweet.id)).toEqual([older, newer]);
    // 投稿自体の作成日時は変えない
    expect((await liked(alice.id, null)).items[0].item.tweet.createdAt).toBe(at(1));
  });

  it('同じ登録を同時に送っても1行だけ作り、どの応答も同じ件数を返す', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const tweet = await fixtures.tweet(alice, '同時', at(1));

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => set(alice.id, tweet, true)));

    expect(outcomes).toEqual(Array.from({ length: 5 }, () => ({ status: 'set', active: true, count: 1 })));
    expect(await rowsOf(alice.id)).toHaveLength(1);
  });

  it('別々の利用者が同時に登録しても、最後に読み返す件数は全員分になる', async () => {
    const owner = await fixtures.user('作者', 'Lk');
    const tweet = await fixtures.tweet(owner, '人気', at(1));
    const people = await Promise.all(Array.from({ length: 5 }, (_, i) => fixtures.user(`人${i}`, 'Lk')));

    const outcomes = await Promise.all(people.map((p) => set(p.id, tweet, true)));

    // 同じ元投稿への操作は直列化されるので、件数は1〜5が1回ずつ現れる
    expect(outcomes.map((o) => (o.status === 'set' ? o.count : -1)).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('対象の投稿がなければtweet-not-found、利用者がいなければactor-not-foundで、行を作らない', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const tweet = await fixtures.tweet(alice, 'a', at(1));

    expect(await set(alice.id, randomUUID(), true)).toEqual({ status: 'tweet-not-found' });
    expect(await set(alice.id, randomUUID(), false)).toEqual({ status: 'tweet-not-found' });
    expect(await set(randomUUID(), tweet, true)).toEqual({ status: 'actor-not-found' });
    expect(await set(randomUUID(), tweet, false)).toEqual({ status: 'actor-not-found' });
    expect(await sql`SELECT 1 FROM twitter.likes WHERE tweet_id = ${tweet}`).toHaveLength(0);
  });

  it('対象の削除と同時に登録しても、成功を装わずtweet-not-foundか削除後に消えた状態になる', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    for (let i = 0; i < 3; i += 1) {
      const tweet = await fixtures.tweet(alice, `競合${i}`, at(i));
      const [outcome, deleted] = await Promise.all([
        set(alice.id, tweet, true),
        new PostgresTweetDeleter(sql).deleteOwned({ actorId: alice.id, tweetId: tweet }),
      ]);
      expect(deleted).toBe('deleted');
      expect([{ status: 'set', active: true, count: 1 }, { status: 'tweet-not-found' }]).toContainEqual(outcome);
      expect(await sql`SELECT 1 FROM twitter.likes WHERE tweet_id = ${tweet}`).toHaveLength(0);
    }
  });

  it('いいねで投稿の本文・日時・revisionを変えず、画像を複製・削除しない', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const draftId = await media.draft(alice.id, new Date());
    const upload = await media.verified(alice.id, draftId, new Date());
    await media.writer.publish({ actorId: alice.id, draftId, value: { content: '画像', uploadIds: [upload.uploadId] }, fingerprint: 'c', now: new Date() });
    const tweetOf = () => sql`SELECT content, created_at, updated_at, revision FROM twitter.tweets WHERE id = ${draftId}`;
    const imagesOf = () => sql`SELECT id, storage_key, position FROM twitter.images WHERE tweet_id = ${draftId}`;
    const [tweetBefore, imagesBefore] = [await tweetOf(), await imagesOf()];

    await set(alice.id, draftId, true);
    await set(alice.id, draftId, false);
    await set(alice.id, draftId, true);

    expect(await tweetOf()).toEqual(tweetBefore);
    expect(await imagesOf()).toEqual(imagesBefore);
    expect(await sql`SELECT 1 FROM twitter.media_delete_jobs WHERE storage_key = ${upload.storageKey}`).toHaveLength(0);
  });

  it('いいねとお気に入りは独立している（片方の操作でもう片方の行・件数を変えない）', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const bob = await fixtures.user('ボブ', 'Lk');
    const tweet = await fixtures.tweet(bob, '独立', at(1));
    const favorites = new PostgresFavoriteRepository(sql);
    const favoritesOf = () => sql`SELECT id, created_at FROM twitter.favorites WHERE user_id = ${alice.id}`;

    await favorites.set({ actorId: alice.id, tweetId: tweet, active: true, id: randomUUID(), now: new Date() });
    const savedBefore = await favoritesOf();
    await set(alice.id, tweet, true);
    await set(alice.id, tweet, false);
    expect(await favoritesOf()).toEqual(savedBefore);

    await set(alice.id, tweet, true);
    const likesBefore = await rowsOf(alice.id);
    await favorites.set({ actorId: alice.id, tweetId: tweet, active: false, id: randomUUID(), now: new Date() });
    expect(await rowsOf(alice.id)).toEqual(likesBefore);
    expect((await liked(alice.id, bob.id)).items.map((e) => e.item.tweet.likeCount)).toEqual([1]);
    expect((await new PostgresFavoriteQuery(sql).findPage({ actorId: alice.id, after: null, limit: 20 })).items).toEqual([]);
  });

  it('無関係なDBエラーは成功扱いせずthrowする', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    await expect(likes.set({ actorId: alice.id, tweetId: 'not-a-uuid', active: true, id: randomUUID(), now: new Date() })).rejects.toThrow();
    const broken = postgres('postgres://nobody:nothing@127.0.0.1:1/none', { connect_timeout: 1, max: 1 });
    try {
      await expect(new PostgresLikeRepository(broken).set({ actorId: alice.id, tweetId: randomUUID(), active: true, id: randomUUID(), now: new Date() })).rejects.toThrow();
    } finally {
      await broken.end({ timeout: 0 });
    }
  });
});

describe('PostgresProfileQuery.findLikedPage', () => {
  it('対象者のいいねだけを、いいね日時の降順（同時刻はUUIDの降順）で元投稿の現在の内容・画像と一緒に返す', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const bob = await fixtures.user('ボブ', 'Lk');
    const draftId = await media.draft(bob.id, new Date());
    const upload = await media.verified(bob.id, draftId, new Date(), { ...PNG_IMAGE, width: 77, height: 10 });
    await media.writer.publish({ actorId: bob.id, draftId, value: { content: '画像付き', uploadIds: [upload.uploadId] }, fingerprint: 'c', now: new Date() });
    const plain = await fixtures.tweet(bob, '元の本文', at(1));
    const [low, high] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    await fixtures.like(alice, plain, at(5, 1), low);
    await fixtures.like(alice, draftId, at(5, 1), high);
    await fixtures.like(bob, plain, at(9)); // 他人のいいねは一覧に出さないが件数には数える
    await sql`UPDATE twitter.tweets SET content = '編集後の本文' WHERE id = ${plain}`;

    // 未ログインでも取得できる
    const page = await liked(alice.id, null);

    expect(page.nextCursor).toBeNull();
    expect(page.items.map((e) => [e.likeId, e.likedAt])).toEqual([
      [high, at(5, 1)],
      [low, at(5, 1)],
    ]);
    expect(page.items[0].item).toMatchObject({
      tweet: { id: draftId, content: '画像付き', author: bob, images: [{ width: 77 }], likeCount: 1, likedByViewer: false, favoritedByViewer: false },
      retweetedBy: null,
    });
    expect(page.items[1].item.tweet).toMatchObject({ id: plain, content: '編集後の本文', images: [], likeCount: 2 });
  });

  it('本人状態は閲覧者について計算し、対象者と取り違えない。対象者のお気に入りは返さない', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const bob = await fixtures.user('ボブ', 'Lk');
    const carol = await fixtures.user('キャロル', 'Lk');
    const tweet = await fixtures.tweet(carol, 'キャロルの投稿', at(1));
    await fixtures.like(alice, tweet, at(2));
    await fixtures.favorite(alice, tweet, at(3)); // 対象者アリスの保存（他人には見せない）

    const asBob = await liked(alice.id, bob.id);
    expect(asBob.items[0].item.tweet).toMatchObject({ likedByViewer: false, favoritedByViewer: false, likeCount: 1 });

    await fixtures.like(bob, tweet, at(4));
    await fixtures.favorite(bob, tweet, at(5));
    expect((await liked(alice.id, bob.id)).items[0].item.tweet).toMatchObject({ likedByViewer: true, favoritedByViewer: true, likeCount: 2 });
    expect((await liked(alice.id, alice.id)).items[0].item.tweet).toMatchObject({ likedByViewer: true, favoritedByViewer: true });
    expect((await liked(alice.id, carol.id)).items[0].item.tweet).toMatchObject({ likedByViewer: false, favoritedByViewer: false });
  });

  it('画像・いいね・お気に入りが複数あっても行や件数を掛け合わせない', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const others = await Promise.all(Array.from({ length: 3 }, (_, i) => fixtures.user(`他${i}`, 'Lk')));
    const draftId = await media.draft(alice.id, new Date());
    const uploads = [];
    for (const width of [10, 20, 30]) uploads.push(await media.verified(alice.id, draftId, new Date(), { ...PNG_IMAGE, width, height: 10 }));
    await media.writer.publish({ actorId: alice.id, draftId, value: { content: '3枚', uploadIds: uploads.map((u) => u.uploadId) }, fingerprint: 'c', now: new Date() });
    await fixtures.like(alice, draftId, at(1));
    for (const [i, person] of others.entries()) {
      await fixtures.like(person, draftId, at(2 + i));
      await fixtures.favorite(person, draftId, at(2 + i));
    }

    const page = await liked(alice.id, others[0].id);

    expect(page.items).toHaveLength(1);
    expect(page.items[0].item.tweet.likeCount).toBe(4);
    expect(page.items[0].item.tweet.images.map((i) => i.width)).toEqual([10, 20, 30]);
  });

  it('21件あれば20件と次のカーソルを返し、マイクロ秒の境界と同時刻を取りこぼさず重複させない', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const tweets = await fixtures.tweets(alice, Array.from({ length: 23 }, (_, i) => ({ content: `t${i}`, createdAt: at(1, i) })));
    // 最初の3件は同時刻、残りは1マイクロ秒ずつずらす
    for (const [i, tweet] of tweets.entries()) await fixtures.like(alice, tweet, at(10, Math.max(0, i - 2)));

    const first = await liked(alice.id, null);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual({ createdAt: first.items[19].likedAt, likeId: first.items[19].likeId });
    const second = await liked(alice.id, null, first.nextCursor);

    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((e) => e.item.tweet.id);
    expect(new Set(all).size).toBe(23);
    expect(all.slice(0, 20)).toEqual([...tweets].reverse().slice(0, 20));
  });

  it('元投稿の削除・作者の退会で一覧から消え、いいねした人の退会ではその人のいいねだけが消える', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const bob = await fixtures.user('ボブ', 'Lk');
    const carol = await fixtures.user('キャロル', 'Lk');
    const bobTweet = await fixtures.tweet(bob, 'ボブ', at(1));
    const carolTweet = await fixtures.tweet(carol, 'キャロル', at(2));
    const aliceTweet = await fixtures.tweet(alice, 'アリス', at(3));
    await fixtures.like(alice, bobTweet, at(4));
    await fixtures.like(alice, carolTweet, at(5));
    await fixtures.like(alice, aliceTweet, at(6));
    const carolLike = await fixtures.like(carol, bobTweet, at(7));

    await new PostgresTweetDeleter(sql).deleteOwned({ actorId: alice.id, tweetId: aliceTweet });
    await new PostgresUserRepository(sql).deleteById(carol.id);
    expect((await liked(alice.id, null)).items.map((e) => [e.item.tweet.id, e.item.tweet.likeCount])).toEqual([[bobTweet, 1]]);
    expect(await sql`SELECT 1 FROM twitter.likes WHERE id = ${carolLike}`).toHaveLength(0);

    await new PostgresUserRepository(sql).deleteById(alice.id);
    expect(await rowsOf(alice.id)).toEqual([]);
    expect(await sql`SELECT 1 FROM twitter.likes WHERE tweet_id = ${bobTweet}`).toHaveLength(0);
  });
});

describe('タイムライン・プロフィールのlikedByViewer / likeCount', () => {
  it('件数は公開、本人状態は閲覧者だけtrue。リツイートカードでも元投稿の値になる', async () => {
    const alice = await fixtures.user('アリス', 'Lk');
    const bob = await fixtures.user('ボブ', 'Lk');
    const tweet = await fixtures.tweet(bob, 'ボブの投稿', at(1));
    const other = await fixtures.tweet(bob, 'いいねしていない投稿', at(2));
    await fixtures.retweet(alice, tweet, at(3));
    await fixtures.like(alice, tweet, at(4));
    await fixtures.like(bob, tweet, at(5));
    const states = (items: { key: { kind: string }; tweet: { id: string; likedByViewer: boolean; likeCount: number } }[]) =>
      items
        .filter((i) => [tweet, other].includes(i.tweet.id))
        .map((i) => [i.key.kind, i.tweet.id === tweet ? 'liked' : 'other', i.tweet.likedByViewer, i.tweet.likeCount]);
    const timeline = new PostgresTimelineQuery(sql);

    expect(states((await timeline.findPage({ followingOnly: false, viewerId: alice.id, after: null, limit: 20 })).items)).toEqual([
      ['retweet', 'liked', true, 2],
      ['tweet', 'other', false, 0],
      ['tweet', 'liked', true, 2],
    ]);
    expect(states((await timeline.findPage({ followingOnly: false, viewerId: null, after: null, limit: 20 })).items)).toEqual([
      ['retweet', 'liked', false, 2],
      ['tweet', 'other', false, 0],
      ['tweet', 'liked', false, 2],
    ]);
    // ボブのプロフィールをアリスが見る（対象者はボブ、閲覧者はアリス）
    const bobsTweets = await profile.findActivityPage({ subjectId: bob.id, viewerId: alice.id, kind: 'tweet', after: null, limit: 20 });
    expect(states(bobsTweets.items)).toEqual([
      ['tweet', 'other', false, 0],
      ['tweet', 'liked', true, 2],
    ]);
    const favorites = await new PostgresFavoriteQuery(sql).findPage({ actorId: alice.id, after: null, limit: 20 });
    expect(favorites.items).toEqual([]);
    await fixtures.favorite(alice, tweet, at(6));
    const saved = await new PostgresFavoriteQuery(sql).findPage({ actorId: alice.id, after: null, limit: 20 });
    expect(saved.items[0].item.tweet).toMatchObject({ likedByViewer: true, likeCount: 2, favoritedByViewer: true });
  });
});
