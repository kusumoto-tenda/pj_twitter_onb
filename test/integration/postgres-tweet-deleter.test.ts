import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { PostgresTweetDeleter } from '@/infra/repositories/postgres-tweet-deleter';
import { PostgresTweetEditor } from '@/infra/repositories/postgres-tweet-editor';
import { MediaFixtures, PNG_IMAGE } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let users: TimelineFixtures;
let media: MediaFixtures;
let deleter: PostgresTweetDeleter;
let editor: PostgresTweetEditor;
const NOW = new Date();
const later = (ms: number) => new Date(NOW.getTime() + ms);
const editDrafts: string[] = [];

beforeAll(async () => {
  sql = await connectTestDatabase();
  users = new TimelineFixtures(sql);
  media = new MediaFixtures(sql);
  deleter = new PostgresTweetDeleter(sql);
  editor = new PostgresTweetEditor(sql);
});

afterEach(async () => {
  const ids = editDrafts.splice(0);
  if (ids.length > 0) {
    await sql`DELETE FROM twitter.images WHERE upload_id IN (SELECT id FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[]))`;
    await sql`DELETE FROM twitter.media_delete_jobs WHERE storage_key IN (SELECT storage_key FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[]))`;
    await sql`DELETE FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM twitter.tweet_drafts WHERE id = ANY(${ids}::uuid[])`;
  }
  await users.cleanup();
  await media.cleanup();
});

afterAll(async () => {
  await sql.end();
});

/** 画像（幅で識別）付きの投稿を作る。投稿IDは作成用の下書きIDと同じ。 */
async function postWithImages(owner: TimelinePerson, content: string, widths: number[] = []) {
  const draftId = await media.draft(owner.id, NOW);
  const uploads = [];
  for (const width of widths) {
    uploads.push((await media.verified(owner.id, draftId, NOW, { ...PNG_IMAGE, width, height: 10 })).uploadId);
  }
  const outcome = await media.writer.publish({
    actorId: owner.id,
    draftId,
    value: { content, uploadIds: uploads },
    fingerprint: 'create',
    now: NOW,
  });
  if (outcome.status !== 'published') throw new Error(outcome.status);
  return draftId;
}

async function imagesOf(tweetId: string) {
  return sql<{ id: string; storage_key: string; upload_id: string }[]>`
    SELECT id, storage_key, upload_id FROM twitter.images WHERE tweet_id = ${tweetId} ORDER BY position
  `;
}

async function count(query: postgres.PendingQuery<postgres.Row[]>) {
  const [{ count }] = await query;
  return Number(count);
}

const tweetCount = (id: string) => count(sql`SELECT count(*) FROM twitter.tweets WHERE id = ${id}`);
const retweetCount = (id: string) => count(sql`SELECT count(*) FROM twitter.retweets WHERE tweet_id = ${id}`);
const jobsFor = (keys: string[]) =>
  sql<{ storage_key: string; not_before: Date; token_valid_until: Date }[]>`
    SELECT j.storage_key, j.not_before, u.token_valid_until FROM twitter.media_delete_jobs j
    JOIN twitter.media_uploads u ON u.storage_key = j.storage_key
    WHERE j.storage_key = ANY(${keys}) ORDER BY j.storage_key
  `;

describe('PostgresTweetDeleter.findTarget', () => {
  it('DBの現在の所有者と本文を返す。存在しなければnull', async () => {
    const alice = await users.user('アリス', 'Dl');
    const tweetId = await postWithImages(alice, '消す本文');

    expect(await deleter.findTarget(tweetId)).toEqual({ tweetId, ownerId: alice.id, content: '消す本文' });
    expect(await deleter.findTarget(randomUUID())).toBeNull();
  });
});

describe('PostgresTweetDeleter.deleteOwned', () => {
  it('本人の投稿を消すと、画像・リツイートも同じトランザクションで消え、画像の実体の削除をトークン期限以降に予約する', async () => {
    const alice = await users.user('アリス', 'Dl');
    const bob = await users.user('ボブ', 'Dl');
    const tweetId = await postWithImages(alice, '消す', [10, 20]);
    const images = await imagesOf(tweetId);
    await users.retweet(bob, tweetId, later(10).toISOString());
    await users.retweet(alice, tweetId, later(20).toISOString());
    // 無関係な投稿・画像・リツイート
    const keepOwn = await postWithImages(alice, '残す', [30]);
    const keepOther = await postWithImages(bob, 'ボブの投稿', [40]);
    await users.retweet(alice, keepOther, later(30).toISOString());
    const kept = [...(await imagesOf(keepOwn)), ...(await imagesOf(keepOther))];

    expect(await deleter.deleteOwned({ actorId: alice.id, tweetId })).toBe('deleted');

    expect(await tweetCount(tweetId)).toBe(0);
    expect(await imagesOf(tweetId)).toEqual([]);
    expect(await retweetCount(tweetId)).toBe(0);
    const jobs = await jobsFor(images.map((i) => i.storage_key));
    expect(jobs.map((j) => j.storage_key)).toEqual(images.map((i) => i.storage_key).sort());
    for (const job of jobs) expect(job.not_before.getTime()).toBeGreaterThanOrEqual(job.token_valid_until.getTime());
    const uploads = await sql`SELECT status FROM twitter.media_uploads WHERE id = ANY(${images.map((i) => i.upload_id)}::uuid[])`;
    expect(uploads.map((u) => u.status)).toEqual(['deleting', 'deleting']);

    expect(await tweetCount(keepOwn)).toBe(1);
    expect(await tweetCount(keepOther)).toBe(1);
    expect(await retweetCount(keepOther)).toBe(1);
    expect((await imagesOf(keepOwn)).length + (await imagesOf(keepOther)).length).toBe(2);
    expect(await jobsFor(kept.map((i) => i.storage_key))).toEqual([]);
  });

  it('他人の投稿はforbidden、存在しない投稿はnot-foundで、何も消さない', async () => {
    const alice = await users.user('アリス', 'Dl');
    const bob = await users.user('ボブ', 'Dl');
    const tweetId = await postWithImages(alice, '消させない', [10]);
    await users.retweet(bob, tweetId, later(10).toISOString());

    expect(await deleter.deleteOwned({ actorId: bob.id, tweetId })).toBe('forbidden');
    expect(await deleter.deleteOwned({ actorId: alice.id, tweetId: randomUUID() })).toBe('not-found');

    expect(await tweetCount(tweetId)).toBe(1);
    expect(await imagesOf(tweetId)).toHaveLength(1);
    expect(await retweetCount(tweetId)).toBe(1);
  });

  it('同時に削除しても、一方だけが削除し、もう一方はロック後の状態でnot-foundになる', async () => {
    const alice = await users.user('アリス', 'Dl');
    const tweetId = await postWithImages(alice, '同時', [10]);

    const outcomes = await Promise.all([
      deleter.deleteOwned({ actorId: alice.id, tweetId }),
      deleter.deleteOwned({ actorId: alice.id, tweetId }),
    ]);

    expect(outcomes.sort()).toEqual(['deleted', 'not-found']);
    expect(await tweetCount(tweetId)).toBe(0);
  });

  it('開いている編集用の下書きがあっても削除でき、下書きの対象はNULLになる。編集中の新規画像は下書きの破棄・期限切れで回収する', async () => {
    const alice = await users.user('アリス', 'Dl');
    const tweetId = await postWithImages(alice, '編集中', [10]);
    const draftId = randomUUID();
    editDrafts.push(draftId);
    const prepared = await editor.prepare({ actorId: alice.id, tweetId, draftId, now: NOW, expiresAt: later(24 * 3600_000) });
    expect(prepared.status).toBe('ready');
    const added = await media.verified(alice.id, draftId, NOW);

    expect(await deleter.deleteOwned({ actorId: alice.id, tweetId })).toBe('deleted');

    const [draft] = await sql`SELECT status, target_tweet_id FROM twitter.tweet_drafts WHERE id = ${draftId}`;
    expect(draft).toEqual({ status: 'open', target_tweet_id: null });
    const [upload] = await sql`SELECT status FROM twitter.media_uploads WHERE id = ${added.uploadId}`;
    expect(upload.status).toBe('verified');
    // 残った編集を確定しようとしても、消えた投稿は作り直さない
    expect(
      await editor.commit({
        actorId: alice.id,
        draftId,
        value: { content: '更新', keepImageIds: [], uploadIds: [added.uploadId] },
        fingerprint: 'f',
        now: later(1000),
      }),
    ).toEqual({ status: 'not-found' });
    expect(await tweetCount(tweetId)).toBe(0);
  });

  // 削除は ON DELETE SET NULL で下書きを更新する。下書きを先にロックしないと、編集の確定とデッドロックする。
  it('編集の確定と同時に削除しても、デッドロックせずにどちらかの順で完了する', async () => {
    const alice = await users.user('アリス', 'Dl');
    for (let i = 0; i < 5; i += 1) {
      const tweetId = await postWithImages(alice, '競合', [10]);
      const draftId = randomUUID();
      editDrafts.push(draftId);
      await editor.prepare({ actorId: alice.id, tweetId, draftId, now: NOW, expiresAt: later(24 * 3600_000) });
      const [image] = await imagesOf(tweetId);

      const [edited, deleted] = await Promise.all([
        editor.commit({
          actorId: alice.id,
          draftId,
          value: { content: '更新', keepImageIds: [image.id], uploadIds: [] },
          fingerprint: 'f',
          now: later(1000),
        }),
        deleter.deleteOwned({ actorId: alice.id, tweetId }),
      ]);

      expect(deleted).toBe('deleted');
      expect(['updated', 'not-found']).toContain(edited.status);
      expect(await tweetCount(tweetId)).toBe(0);
    }
  }, 120_000);

  it('途中でDBが失敗したら、投稿・画像・リツイート・削除予約をすべてロールバックし、例外を返す', async () => {
    const alice = await users.user('アリス', 'Dl');
    const bob = await users.user('ボブ', 'Dl');
    const tweetId = await postWithImages(alice, '失敗', [10]);
    const images = await imagesOf(tweetId);
    await users.retweet(bob, tweetId, later(10).toISOString());
    // この投稿のリツイートがCASCADEで消える時だけ失敗させる（テスト専用DBの一時トリガー）
    const suffix = randomUUID().replaceAll('-', '');
    const fn = `twitter.fail_retweet_delete_${suffix}`;
    const trigger = `fail_retweet_delete_${suffix}`;
    await sql.unsafe(`
      CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.tweet_id = '${tweetId}'::uuid THEN RAISE EXCEPTION 'injected failure'; END IF;
        RETURN OLD;
      END;
      $$;
      CREATE TRIGGER ${trigger} AFTER DELETE ON twitter.retweets FOR EACH ROW EXECUTE FUNCTION ${fn}();
    `);
    try {
      await expect(deleter.deleteOwned({ actorId: alice.id, tweetId })).rejects.toThrow('injected failure');
    } finally {
      await sql.unsafe(`DROP TRIGGER ${trigger} ON twitter.retweets; DROP FUNCTION ${fn}();`);
    }

    expect(await tweetCount(tweetId)).toBe(1);
    expect(await imagesOf(tweetId)).toEqual(images);
    expect(await retweetCount(tweetId)).toBe(1);
    expect(await jobsFor(images.map((i) => i.storage_key))).toEqual([]);
    const [upload] = await sql`SELECT status FROM twitter.media_uploads WHERE id = ${images[0].upload_id}`;
    expect(upload.status).toBe('attached');
  });
});
