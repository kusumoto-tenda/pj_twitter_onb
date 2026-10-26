import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelinePerson } from '@/application/timeline/timeline';
import { PostgresTimelineQuery } from '@/infra/queries/postgres-timeline-query';
import {
  connectTestDatabase,
  deleteUsersByDisplayIds,
  uniqueDisplayId,
} from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let query: PostgresTimelineQuery;
let fixtures: TimelineFixtures;

// 既存データより新しくなるよう、遠い未来の時刻を使う。テストごとに年をずらして干渉を避ける。
let year = 2900 + Math.floor(Math.random() * 50);
const at = (minute: number, micro = 0) =>
  `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.${String(micro).padStart(6, '0')}Z`;

beforeAll(async () => {
  sql = await connectTestDatabase();
  query = new PostgresTimelineQuery(sql);
  fixtures = new TimelineFixtures(sql);
});

afterEach(async () => {
  await fixtures.cleanup();
  year += 1;
});

afterAll(async () => {
  await sql.end();
});

/** 全体一覧から、このテストで作った出来事だけを順番どおりに取り出す。 */
async function globalEvents(ids: Set<string>): Promise<TimelineItem[]> {
  const page = await query.findPage({ followingOnly: false, viewerId: null, after: null, limit: 100 });
  return page.items.filter((item) => ids.has(item.key.eventId));
}

async function followingEvents(viewer: TimelinePerson, limit = 100) {
  return (await query.findPage({ followingOnly: true, viewerId: viewer.id, after: null, limit }))
    .items;
}

describe('PostgresTimelineQuery', () => {
  it('通常投稿を投稿者の公開情報付きで取得する', async () => {
    const alice = await fixtures.user('アリス');
    const tweetId = await fixtures.tweet(alice, 'こんにちは\n世界', at(1, 123456));

    const [item] = await globalEvents(new Set([tweetId]));

    expect(item).toEqual({
      key: { eventAt: at(1, 123456), kind: 'tweet', eventId: tweetId },
      tweet: {
        id: tweetId,
        content: 'こんにちは\n世界',
        author: alice,
        createdAt: at(1, 123456),
        images: [],
        favoritedByViewer: false,
        likedByViewer: false,
        likeCount: 0,
      },
      retweetedBy: null,
    });
    expect(JSON.stringify(item)).not.toMatch(/password|fixture-hash/);
  });

  it('投稿とリツイートを出来事の日時の降順に並べ、updated_atでは順序を変えない', async () => {
    const alice = await fixtures.user('アリス');
    const bob = await fixtures.user('ボブ');
    const old = await fixtures.tweet(alice, '古い投稿', at(1), at(59));
    const middle = await fixtures.tweet(bob, '中間の投稿', at(2));
    const retweet = await fixtures.retweet(bob, old, at(3));

    const items = await globalEvents(new Set([old, middle, retweet]));

    expect(items.map((item) => [item.key.kind, item.key.eventId])).toEqual([
      ['retweet', retweet],
      ['tweet', middle],
      ['tweet', old],
    ]);
    expect(items[0].tweet).toMatchObject({ id: old, content: '古い投稿', author: alice });
    expect(items[0].retweetedBy).toEqual(bob);
    expect(items[0].key.eventAt).toBe(at(3));
  });

  it('フォロー一覧は出来事の実行者で絞り込む', async () => {
    const a = await fixtures.user('A');
    const b = await fixtures.user('B');
    const c = await fixtures.user('C');
    await fixtures.follow(a, b);
    const aTweet = await fixtures.tweet(a, 'Aの投稿', at(1));
    const bTweet = await fixtures.tweet(b, 'Bの投稿', at(2));
    const cTweet = await fixtures.tweet(c, 'Cの投稿', at(3));
    const bRetweetsC = await fixtures.retweet(b, cTweet, at(4));
    const cRetweetsB = await fixtures.retweet(c, bTweet, at(5));
    const aRetweetsC = await fixtures.retweet(a, cTweet, at(6));
    const all = new Set([aTweet, bTweet, cTweet, bRetweetsC, cRetweetsB, aRetweetsC]);

    const global = await globalEvents(all);
    const following = (await followingEvents(a)).filter((item) => all.has(item.key.eventId));

    expect(global.map((item) => item.key.eventId)).toEqual([
      aRetweetsC,
      cRetweetsB,
      bRetweetsC,
      cTweet,
      bTweet,
      aTweet,
    ]);
    expect(following.map((item) => item.key.eventId)).toEqual([
      aRetweetsC,
      bRetweetsC,
      bTweet,
      aTweet,
    ]);
  });

  it('フォロー0人でも自分の投稿・リツイートを表示し、他人の出来事は含めない', async () => {
    const loner = await fixtures.user('ひとり');
    const other = await fixtures.user('ほか');
    const otherTweet = await fixtures.tweet(other, 'ほかの投稿', at(1));
    const own = await fixtures.tweet(loner, '自分の投稿', at(2));
    const ownRetweet = await fixtures.retweet(loner, otherTweet, at(3));

    const items = await followingEvents(loner);

    expect(items.map((item) => item.key.eventId)).toEqual([ownRetweet, own]);
  });

  it('同じ投稿の元投稿と複数のリツイートを別の出来事として表示する', async () => {
    const alice = await fixtures.user('アリス');
    const bob = await fixtures.user('ボブ');
    const carol = await fixtures.user('キャロル');
    const tweetId = await fixtures.tweet(alice, '話題の投稿', at(1));
    const byBob = await fixtures.retweet(bob, tweetId, at(2));
    const byCarol = await fixtures.retweet(carol, tweetId, at(3));

    const items = await globalEvents(new Set([tweetId, byBob, byCarol]));

    expect(items.map((item) => [item.key.eventId, item.retweetedBy?.name ?? null])).toEqual([
      [byCarol, 'キャロル'],
      [byBob, 'ボブ'],
      [tweetId, null],
    ]);
  });

  it('同一時刻・マイクロ秒差・種類違いを含む45件を、重複・欠落なくページ送りできる', async () => {
    const viewer = await fixtures.user('ページ送り');
    const sameTime = at(10, 500000);
    const tweetItems = [
      // 同一時刻の通常投稿5件
      ...Array.from({ length: 5 }, (_, i) => ({ content: `同時刻${i}`, createdAt: sameTime })),
      // 1マイクロ秒ずつ異なる投稿
      ...Array.from({ length: 30 }, (_, i) => ({
        content: `マイクロ秒${i}`,
        createdAt: at(10, 500001 + i),
      })),
    ];
    const tweetIds = await fixtures.tweets(viewer, tweetItems);
    // 同一時刻のリツイート（種類で順番が決まる）
    const retweetIds: string[] = [];
    for (const tweetId of tweetIds.slice(0, 10)) {
      retweetIds.push(await fixtures.retweet(viewer, tweetId, sameTime));
    }
    const expected = new Set([...tweetIds, ...retweetIds]);
    expect(expected.size).toBe(45);

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let after = null;
    for (let i = 0; i < 10; i++) {
      const page = await query.findPage({ followingOnly: true, viewerId: viewer.id, after, limit: 20 });
      pageSizes.push(page.items.length);
      seen.push(...page.items.map((item) => `${item.key.kind}:${item.key.eventId}`));
      if (!page.nextCursor) break;
      expect(page.nextCursor).toEqual(page.items.at(-1)!.key);
      after = page.nextCursor;
    }

    expect(pageSizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
    expect(seen.map((key) => key.split(':')[1]).sort()).toEqual([...expected].sort());

    // 一括取得した順番とページ送りの順番が一致する
    const all = await followingEvents(viewer);
    expect(all.map((item) => `${item.key.kind}:${item.key.eventId}`)).toEqual(seen);
    // 同一時刻ではretweetが先、同じ種類の中ではUUIDの降順
    const sameTimeKeys = all.filter((item) => item.key.eventAt === sameTime).map((item) => item.key);
    expect(sameTimeKeys.slice(0, 10).every((key) => key.kind === 'retweet')).toBe(true);
    const sameTimeTweetIds = sameTimeKeys.filter((key) => key.kind === 'tweet').map((key) => key.eventId);
    expect(sameTimeTweetIds).toEqual([...sameTimeTweetIds].sort().reverse());
  });

  it.each([
    [0, false],
    [20, false],
    [21, true],
  ])('%i件ならnextCursorの有無は%s', async (count, hasNext) => {
    const viewer = await fixtures.user('件数');
    if (count > 0) {
      await fixtures.tweets(
        viewer,
        Array.from({ length: count }, (_, i) => ({ content: `投稿${i}`, createdAt: at(20, i) })),
      );
    }

    const page = await query.findPage({ followingOnly: true, viewerId: viewer.id, after: null, limit: 20 });

    expect(page.items).toHaveLength(Math.min(count, 20));
    expect(page.nextCursor === null).toBe(!hasNext);
  });

  it('不正なFK、フォロー・リツイートの重複、自己フォロー、空・281文字の本文をDBが拒否する', async () => {
    const a = await fixtures.user('A');
    const b = await fixtures.user('B');
    const tweetId = await fixtures.tweet(a, '投稿', at(1));
    await fixtures.follow(a, b);
    await fixtures.retweet(b, tweetId, at(2));

    await expect(fixtures.tweet({ ...a, id: randomUUID() }, '存在しない投稿者', at(3))).rejects.toThrow();
    await expect(fixtures.retweet(b, randomUUID(), at(3))).rejects.toThrow();
    await expect(fixtures.follow(a, b)).rejects.toThrow();
    await expect(fixtures.retweet(b, tweetId, at(4))).rejects.toThrow();
    await expect(fixtures.follow(a, a)).rejects.toThrow();
    await expect(fixtures.tweet(a, '', at(5))).rejects.toThrow();
    await expect(fixtures.tweet(a, 'あ'.repeat(281), at(5))).rejects.toThrow();
    await expect(fixtures.tweet(a, '😀'.repeat(280), at(5))).resolves.toBeDefined();
  });

  it('利用者を削除すると投稿・フォロー・リツイートも削除され、既存のユーザー削除処理が使える', async () => {
    const displayId = uniqueDisplayId('Cs');
    const userId = randomUUID();
    await sql`
      INSERT INTO twitter.users (id, name, display_id, bio, password_hash, created_at)
      VALUES (${userId}, '削除される人', ${displayId}, '', 'x', now())
    `;
    const person = { id: userId, name: '削除される人', displayId };
    const other = await fixtures.user('残る人');
    const tweetId = await fixtures.tweet(person, '消える投稿', at(1));
    await fixtures.retweet(other, tweetId, at(2));
    await fixtures.follow(other, person);

    await deleteUsersByDisplayIds(sql, [displayId]);

    const [counts] = await sql`
      SELECT
        (SELECT count(*)::int FROM twitter.tweets WHERE owner_id = ${userId}) AS tweets,
        (SELECT count(*)::int FROM twitter.retweets WHERE tweet_id = ${tweetId}) AS retweets,
        (SELECT count(*)::int FROM twitter.follows WHERE follow_id = ${userId}) AS follows
    `;
    expect(counts).toEqual({ tweets: 0, retweets: 0, follows: 0 });
  });
});
