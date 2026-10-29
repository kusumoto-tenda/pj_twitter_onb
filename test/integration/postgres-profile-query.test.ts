import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelinePerson } from '@/application/dtos/timeline/timeline';
import { PostgresProfileQuery } from '@/infra/persistence/postgres/query_services/postgres-profile-query';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let query: PostgresProfileQuery;
let fixtures: TimelineFixtures;

let year = 2600 + Math.floor(Math.random() * 50);
const at = (minute: number, micro = 0) =>
  `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.${String(micro).padStart(6, '0')}Z`;

beforeAll(async () => {
  sql = await connectTestDatabase();
  query = new PostgresProfileQuery(sql);
  fixtures = new TimelineFixtures(sql);
});

afterEach(async () => {
  await fixtures.cleanup();
  year += 1;
});

afterAll(async () => {
  await sql.end();
});

const ids = (items: { key: { eventId: string } }[]) => items.map((item) => item.key.eventId);

describe('findSummary', () => {
  it('大小文字を変えたIDから、名前・保存済みID・bio・作成日を取得する', async () => {
    const alice = await fixtures.user('アリス', 'Pa', {
      bio: 'こんにちは\n<b>よろしく</b>',
      createdAt: at(1, 123456),
    });

    const summary = await query.findSummary({ displayId: alice.displayId.toUpperCase(), viewerId: null });

    expect(summary).toEqual({
      ...alice,
      bio: 'こんにちは\n<b>よろしく</b>',
      createdAt: at(1, 123456),
      followingCount: 0,
      followerCount: 0,
      followedByViewer: false,
    });
    expect(JSON.stringify(summary)).not.toMatch(/password|fixture-hash/);
  });

  it('未登録なら null を返す', async () => {
    expect(await query.findSummary({ displayId: 'Nobody_xyz', viewerId: null })).toBeNull();
  });

  it('フォロー数・フォロワー数を向きごとに独立して数える（掛け合わせない）', async () => {
    const [a, b, c, d, e, f] = await Promise.all(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => fixtures.user(name)),
    );
    await fixtures.follow(a, b);
    await fixtures.follow(a, c);
    for (const follower of [d, e, f]) await fixtures.follow(follower, a);

    const summary = await query.findSummary({ displayId: a.displayId, viewerId: null });

    expect(summary).toMatchObject({ followingCount: 2, followerCount: 3 });
  });

  it('閲覧者が対象をフォローしているかを返す', async () => {
    const subject = await fixtures.user('対象');
    const fan = await fixtures.user('フォロー済み');
    const stranger = await fixtures.user('未フォロー');
    await fixtures.follow(fan, subject);
    // 逆向きの関係はフォロー済みにしない
    await fixtures.follow(subject, stranger);

    const check = async (viewer: TimelinePerson | null) =>
      (await query.findSummary({ displayId: subject.displayId, viewerId: viewer?.id ?? null }))
        ?.followedByViewer;

    expect(await check(fan)).toBe(true);
    expect(await check(stranger)).toBe(false);
    expect(await check(null)).toBe(false);
  });
});

describe('findActivityPage', () => {
  it('投稿タブは対象者の通常投稿だけ、リツイートタブは対象者が実行したリツイートだけを返す', async () => {
    const a = await fixtures.user('A');
    const b = await fixtures.user('B');
    const aTweet = await fixtures.tweet(a, 'Aの投稿', at(1));
    const bTweet = await fixtures.tweet(b, 'Bの投稿', at(2));
    const aRetweetsB = await fixtures.retweet(a, bTweet, at(3));
    await fixtures.retweet(b, aTweet, at(4)); // BによるAの投稿のリツイート（Aの一覧には含めない）

    const tweets = await query.findActivityPage({ subjectId: a.id, viewerId: null, kind: 'tweet', after: null, limit: 20 });
    const retweets = await query.findActivityPage({
      subjectId: a.id,
      viewerId: null,
      kind: 'retweet',
      after: null,
      limit: 20,
    });

    expect(ids(tweets.items)).toEqual([aTweet]);
    expect(tweets.items[0]).toMatchObject({ retweetedBy: null, tweet: { author: a } });
    expect(ids(retweets.items)).toEqual([aRetweetsB]);
    expect(retweets.items[0]).toMatchObject({
      key: { kind: 'retweet', eventAt: at(3) },
      retweetedBy: a,
      tweet: { id: bTweet, author: b, content: 'Bの投稿' },
    });
    expect(JSON.stringify([tweets, retweets])).not.toMatch(/password|fixture-hash/);
  });

  it.each([
    [0, false],
    [20, false],
    [21, true],
  ])('%i件ならnextCursorの有無は%s', async (count, hasNext) => {
    const a = await fixtures.user('件数');
    if (count > 0) {
      await fixtures.tweets(
        a,
        Array.from({ length: count }, (_, i) => ({ content: `投稿${i}`, createdAt: at(5, i) })),
      );
    }

    const page = await query.findActivityPage({ subjectId: a.id, viewerId: null, kind: 'tweet', after: null, limit: 20 });

    expect(page.items).toHaveLength(Math.min(count, 20));
    expect(page.nextCursor === null).toBe(!hasNext);
  });

  it('同時刻・マイクロ秒差を含む投稿とリツイートを、重複・欠落なくページ送りできる', async () => {
    const a = await fixtures.user('ページ送り');
    const other = await fixtures.user('元投稿者');
    const same = at(10, 500000);
    const tweetIds = await fixtures.tweets(a, [
      ...Array.from({ length: 6 }, (_, i) => ({ content: `同時刻${i}`, createdAt: same })),
      ...Array.from({ length: 19 }, (_, i) => ({ content: `マイクロ${i}`, createdAt: at(10, 500001 + i) })),
    ]);
    const sources = await fixtures.tweets(
      other,
      Array.from({ length: 25 }, (_, i) => ({ content: `元${i}`, createdAt: at(1, i) })),
    );
    const retweetIds: string[] = [];
    for (const [i, source] of sources.entries()) {
      retweetIds.push(await fixtures.retweet(a, source, i < 6 ? same : at(10, 500001 + i)));
    }

    for (const [kind, expected] of [
      ['tweet', tweetIds],
      ['retweet', retweetIds],
    ] as const) {
      const seen: string[] = [];
      let after = null;
      for (let i = 0; i < 5; i++) {
        const page = await query.findActivityPage({ subjectId: a.id, viewerId: null, kind, after, limit: 20 });
        seen.push(...ids(page.items));
        if (!page.nextCursor) break;
        after = page.nextCursor;
      }
      expect(seen).toHaveLength(25);
      expect([...seen].sort()).toEqual([...expected].sort());
    }
  });
});

describe('findConnectionsPage', () => {
  it('followingは対象者がフォローしている人、followersは対象者をフォローしている人を返す', async () => {
    const a = await fixtures.user('A');
    const followee = await fixtures.user('フォロー先');
    const follower = await fixtures.user('フォロワー');
    await fixtures.follow(a, followee, at(1));
    await fixtures.follow(follower, a, at(2));

    const following = await query.findConnectionsPage({
      subjectId: a.id,
      direction: 'following',
      after: null,
      limit: 20,
    });
    const followers = await query.findConnectionsPage({
      subjectId: a.id,
      direction: 'followers',
      after: null,
      limit: 20,
    });

    expect(following).toEqual({ items: [followee], nextCursor: null });
    expect(followers).toEqual({ items: [follower], nextCursor: null });
  });

  it('関係の作成日時・関係UUIDの降順に並べ、同時刻・マイクロ秒差でも重複・欠落なくページ送りできる', async () => {
    const a = await fixtures.user('人気者');
    const fans = await Promise.all(Array.from({ length: 25 }, (_, i) => fixtures.user(`ファン${i}`)));
    const same = at(20, 700000);
    const relationIds: string[] = [];
    for (const [i, fan] of fans.entries()) {
      relationIds.push(await fixtures.follow(fan, a, i < 6 ? same : at(20, 700001 + i)));
    }

    const first = await query.findConnectionsPage({
      subjectId: a.id,
      direction: 'followers',
      after: null,
      limit: 20,
    });
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await query.findConnectionsPage({
      subjectId: a.id,
      direction: 'followers',
      after: first.nextCursor,
      limit: 20,
    });

    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((person) => person.id);
    expect(new Set(seen).size).toBe(25);
    expect([...seen].sort()).toEqual(fans.map((fan) => fan.id).sort());
    // 最新（最後に作った関係）が先頭
    expect(first.items[0].id).toBe(fans[24].id);
    // 同時刻の関係は関係UUIDの降順
    const sameTime = relationIds.slice(0, 6);
    const tail = [...first.items, ...second.items].slice(-6).map((p) => fans.findIndex((f) => f.id === p.id));
    expect(tail.map((i) => relationIds[i])).toEqual([...sameTime].sort().reverse());
    expect(JSON.stringify([first, second])).not.toMatch(/password|fixture-hash|bio/);
  });

  it('関係のない利用者は0件で、カーソルのUUIDはランダムでも他人の関係を返さない', async () => {
    const lonely = await fixtures.user('ひとり');

    const page = await query.findConnectionsPage({
      subjectId: lonely.id,
      direction: 'following',
      after: { createdAt: at(59), relationId: randomUUID() },
      limit: 20,
    });

    expect(page).toEqual({ items: [], nextCursor: null });
  });
});
