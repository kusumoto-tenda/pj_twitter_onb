import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelinePerson } from '@/application/dtos/timeline/timeline';
import { PostgresProfileQuery } from '@/infra/persistence/postgres/query_services/postgres-profile-query';
import { PostgresTimelineQuery } from '@/infra/persistence/postgres/query_services/postgres-timeline-query';
import { MediaFixtures, PNG_IMAGE } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let users: TimelineFixtures;
let media: MediaFixtures;
let year = 5100 + Math.floor(Math.random() * 300);
const at = (minute: number) => new Date(`${year}-01-01T00:${String(minute).padStart(2, '0')}:00.000Z`);

beforeAll(async () => {
  sql = await connectTestDatabase();
  users = new TimelineFixtures(sql);
  media = new MediaFixtures(sql);
});

afterEach(async () => {
  await users.cleanup();
  await media.cleanup();
  year += 1;
});

afterAll(async () => {
  await sql.end();
});

/** 寸法の違う画像を付けた投稿を作る（widthで表示順を確認する）。 */
async function tweetWithImages(owner: TimelinePerson, content: string, widths: number[], createdAt: Date) {
  const draftId = await media.draft(owner.id, createdAt);
  const uploads = [];
  for (const width of widths) {
    uploads.push((await media.verified(owner.id, draftId, createdAt, { ...PNG_IMAGE, width, height: 10 })).uploadId);
  }
  const outcome = await media.writer.publish({
    actorId: owner.id,
    draftId,
    value: { content, uploadIds: uploads },
    fingerprint: content,
    now: createdAt,
  });
  if (outcome.status !== 'published') throw new Error(outcome.status);
  return draftId;
}

describe('一覧の添付画像', () => {
  it('メイン・プロフィールの投稿とリツイートで、画像を表示順のまま返す（画像なしは空配列）', async () => {
    const alice = await users.user('アリス', 'Ti');
    const bob = await users.user('ボブ', 'Ti');
    const withImages = await tweetWithImages(alice, '', [30, 10, 20], at(1));
    const textOnly = await users.tweet(alice, '本文だけ', at(2).toISOString());
    const retweet = await users.retweet(bob, withImages, at(3).toISOString());

    const timeline = await new PostgresTimelineQuery(sql).findPage({ followingOnly: false, viewerId: null, after: null, limit: 100 });
    const byEvent = new Map(timeline.items.map((i) => [i.key.eventId, i]));
    expect(byEvent.get(withImages)?.tweet.images.map((i) => [i.position, i.width])).toEqual([
      [0, 30],
      [1, 10],
      [2, 20],
    ]);
    expect(byEvent.get(withImages)?.tweet.images[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      position: 0,
      width: 30,
      height: 10,
    });
    expect(byEvent.get(textOnly)?.tweet.images).toEqual([]);
    expect(byEvent.get(retweet)?.tweet.images.map((i) => i.width)).toEqual([30, 10, 20]);
    expect(JSON.stringify(timeline)).not.toMatch(/storage_key|tweet-uploads/);

    const profiles = new PostgresProfileQuery(sql);
    const tweets = await profiles.findActivityPage({ subjectId: alice.id, viewerId: null, kind: 'tweet', after: null, limit: 20 });
    expect(tweets.items.find((i) => i.key.eventId === withImages)?.tweet.images.map((i) => i.width)).toEqual([30, 10, 20]);
    const retweets = await profiles.findActivityPage({ subjectId: bob.id, viewerId: null, kind: 'retweet', after: null, limit: 20 });
    expect(retweets.items[0].tweet.images.map((i) => i.width)).toEqual([30, 10, 20]);
  }, 120_000);

  it('画像を付けた投稿が多くても、20件の選択・件数・重複に影響しない', async () => {
    const alice = await users.user('アリス', 'Ti');
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await tweetWithImages(alice, `画像${i}`, [10, 20, 30, 40], at(10 + i)));
    await users.tweets(
      alice,
      Array.from({ length: 20 }, (_, i) => ({ content: `本文${i}`, createdAt: at(30 + i).toISOString() })),
    );

    const page = await new PostgresProfileQuery(sql).findActivityPage({ subjectId: alice.id, viewerId: null, kind: 'tweet', after: null, limit: 20 });

    expect(page.items).toHaveLength(20);
    expect(new Set(page.items.map((i) => i.key.eventId)).size).toBe(20);
    const next = await new PostgresProfileQuery(sql).findActivityPage({
      subjectId: alice.id,
      viewerId: null,
      kind: 'tweet',
      after: page.nextCursor,
      limit: 20,
    });
    expect(next.items.map((i) => i.key.eventId).sort()).toEqual([...ids].sort());
    expect(next.items.every((i) => i.tweet.images.length === 4)).toBe(true);
  }, 180_000);
});
