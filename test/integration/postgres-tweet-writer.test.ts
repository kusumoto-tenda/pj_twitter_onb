import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { MediaFixtures } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let users: TimelineFixtures;
let media: MediaFixtures;
const NOW = new Date();

beforeAll(async () => {
  sql = await connectTestDatabase();
  users = new TimelineFixtures(sql);
  media = new MediaFixtures(sql);
});

afterEach(async () => {
  await users.cleanup();
  await media.cleanup();
});

afterAll(async () => {
  await sql.end();
});

const fingerprint = (content: string, uploadIds: string[] = []) => JSON.stringify([content, uploadIds]);

async function publish(actor: TimelinePerson, draftId: string, content: string, uploadIds: string[] = []) {
  return media.writer.publish({
    actorId: actor.id,
    draftId,
    value: { content, uploadIds },
    fingerprint: fingerprint(content, uploadIds),
    now: NOW,
  });
}

async function tweetRow(id: string) {
  const [row] = await sql`
    SELECT owner_id, content, created_at, updated_at FROM twitter.tweets WHERE id = ${id}
  `;
  return row;
}

async function imagesOf(tweetId: string) {
  return sql`SELECT upload_id, position, width, height, content_type FROM twitter.images WHERE tweet_id = ${tweetId} ORDER BY position`;
}

describe('PostgresTweetWriter.publish', () => {
  it('本文だけの投稿を、下書きIDを投稿UUIDとし、投稿日・編集日を同じ時刻で保存する', async () => {
    const alice = await users.user('アリス', 'Tw');
    const draftId = await media.draft(alice.id);

    expect(await publish(alice, draftId, '本文だけ')).toEqual({ status: 'published', tweetId: draftId, replayed: false });

    const row = await tweetRow(draftId);
    expect(row).toMatchObject({ owner_id: alice.id, content: '本文だけ' });
    expect(row.created_at).toEqual(row.updated_at);
    expect(row.created_at.getTime()).toBe(NOW.getTime());
    const [draft] = await sql`SELECT status, published_tweet_id FROM twitter.tweet_drafts WHERE id = ${draftId}`;
    expect(draft).toEqual({ status: 'published', published_tweet_id: draftId });
  });

  it('画像だけ・本文と画像の投稿を、選択順のpositionで原子的に保存する', async () => {
    const alice = await users.user('アリス', 'Tw');
    const draftId = await media.draft(alice.id);
    const uploads = [];
    for (let i = 0; i < 4; i++) uploads.push((await media.verified(alice.id, draftId)).uploadId);
    const order = [uploads[2], uploads[0], uploads[3], uploads[1]];

    expect(await publish(alice, draftId, '', order)).toMatchObject({ status: 'published' });

    expect((await imagesOf(draftId)).map((r) => [r.upload_id, r.position])).toEqual(order.map((id, i) => [id, i]));
    const statuses = await sql`SELECT DISTINCT status FROM twitter.media_uploads WHERE draft_id = ${draftId}`;
    expect(statuses.map((r) => r.status)).toEqual(['attached']);
  });

  it('投稿に使わなかった予約・検証済みの画像を、確定と同じトランザクションで破棄し、トークン期限後の削除を予約する', async () => {
    const alice = await users.user('アリス', 'Tw');
    const draftId = await media.draft(alice.id);
    const used = await media.verified(alice.id, draftId);
    const unusedVerified = await media.verified(alice.id, draftId);
    const unusedReserved = await media.reserved(alice.id, draftId);

    expect(await publish(alice, draftId, '1枚だけ使う', [used.uploadId])).toMatchObject({ status: 'published' });

    const rows = await sql`
      SELECT u.id, u.status, u.token_valid_until, j.not_before
      FROM twitter.media_uploads u
      LEFT JOIN twitter.media_delete_jobs j ON j.storage_key = u.storage_key
      WHERE u.draft_id = ${draftId}
    `;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(used.uploadId)).toMatchObject({ status: 'attached', not_before: null });
    for (const upload of [unusedVerified, unusedReserved]) {
      const row = byId.get(upload.uploadId)!;
      expect(row.status).toBe('discarded');
      expect(row.not_before).toEqual(row.token_valid_until);
    }
    // 回収の保持対象（公開中・有効な下書きで使用中）からも外れる
    const kept = await media.media.findKeptStorageKeys([used.storageKey, unusedVerified.storageKey, unusedReserved.storageKey]);
    expect([...kept]).toEqual([used.storageKey]);
  });

  it('本文が空で画像もない投稿は、コミット時にDBが拒否する', async () => {
    const alice = await users.user('アリス', 'Tw');

    await expect(users.tweet(alice, '', new Date().toISOString())).rejects.toThrow();
    await expect(users.tweet(alice, ' \n　', new Date().toISOString())).rejects.toThrow();
    await expect(users.tweet(alice, 'あ'.repeat(281), new Date().toISOString())).rejects.toThrow();
  });

  it('5枚目・positionの重複・投稿済み画像の再利用をDBが拒否する', async () => {
    const alice = await users.user('アリス', 'Tw');
    const draftId = await media.draft(alice.id);
    const first = await media.verified(alice.id, draftId);
    await publish(alice, draftId, '', [first.uploadId]);
    const other = await media.verified(alice.id, await media.draft(alice.id));

    await expect(sql`
      INSERT INTO twitter.images (id, tweet_id, upload_id, storage_key, position, size_bytes, content_type, width, height)
      VALUES (${randomUUID()}, ${draftId}, ${other.uploadId}, ${other.storageKey}, 0, 1, 'image/png', 1, 1)
    `).rejects.toThrow();
    await expect(sql`
      INSERT INTO twitter.images (id, tweet_id, upload_id, storage_key, position, size_bytes, content_type, width, height)
      VALUES (${randomUUID()}, ${draftId}, ${other.uploadId}, ${other.storageKey}, 4, 1, 'image/png', 1, 1)
    `).rejects.toThrow();

    const reuseDraft = await media.draft(alice.id);
    expect(await publish(alice, reuseDraft, '', [first.uploadId])).toEqual({ status: 'upload-not-ready' });
  });

  it('同じ下書きの同時確定は1投稿だけ。同じ内容の再送は同じ投稿を返し、別の内容は競合にする', async () => {
    const alice = await users.user('アリス', 'Tw');
    const same = await media.draft(alice.id);

    const outcomes = await Promise.all([publish(alice, same, '同時'), publish(alice, same, '同時')]);
    expect(outcomes.map((o) => o.status)).toEqual(['published', 'published']);
    expect(outcomes.map((o) => 'replayed' in o && o.replayed).sort()).toEqual([false, true]);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM twitter.tweets WHERE id = ${same}`;
    expect(count).toBe(1);

    const differ = await media.draft(alice.id);
    const results = await Promise.all([publish(alice, differ, 'A'), publish(alice, differ, 'B')]);
    expect(results.map((o) => o.status).sort()).toEqual(['conflict', 'published']);
  });

  it('未検証・他人・別の下書き・破棄済みの画像、期限切れの下書きでは確定しない', async () => {
    const alice = await users.user('アリス', 'Tw');
    const bob = await users.user('ボブ', 'Tw');
    const draftId = await media.draft(alice.id);
    const unverified = await media.reserved(alice.id, draftId);
    const fromOther = await media.verified(alice.id, await media.draft(alice.id));
    const bobs = await media.verified(bob.id, await media.draft(bob.id));
    const discarded = await media.verified(alice.id, draftId);
    await media.media.discardUpload({ actorId: alice.id, uploadId: discarded.uploadId, now: NOW });

    for (const upload of [unverified, fromOther, bobs, discarded]) {
      expect(await publish(alice, draftId, 'a', [upload.uploadId])).toEqual({ status: 'upload-not-ready' });
    }
    const expired = await media.draft(alice.id, new Date(NOW.getTime() - 25 * 3600_000));
    expect(await publish(alice, expired, 'a')).toEqual({ status: 'draft-closed' });
    expect(await publish(bob, draftId, 'a')).toEqual({ status: 'forbidden' });
    expect(await publish(alice, randomUUID(), 'a')).toEqual({ status: 'draft-not-found' });
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM twitter.tweets WHERE owner_id = ${alice.id}`;
    expect(count).toBe(0);
  });

  it('利用者を削除した後は、その下書きから投稿できない（不完全な投稿を残さない）', async () => {
    const alice = await users.user('アリス', 'Tw');
    const draftId = await media.draft(alice.id);
    const upload = await media.verified(alice.id, draftId);

    await new PostgresUserRepository(sql).deleteById(alice.id);

    expect(await publish(alice, draftId, '', [upload.uploadId])).toEqual({ status: 'forbidden' });
    expect(await tweetRow(draftId)).toBeUndefined();
    // 回収のため、予約の行は所有者なしで残る
    const [row] = await sql`SELECT owner_id, status FROM twitter.media_uploads WHERE id = ${upload.uploadId}`;
    expect(row).toEqual({ owner_id: null, status: 'verified' });
  });

  it('アカウント削除のCASCADEで画像行が消え、実体の削除予約が同じトランザクションで残る。他人の画像は残る', async () => {
    const alice = await users.user('アリス', 'Tw');
    const bob = await users.user('ボブ', 'Tw');
    const aliceDraft = await media.draft(alice.id);
    const aliceUpload = await media.verified(alice.id, aliceDraft);
    await publish(alice, aliceDraft, '', [aliceUpload.uploadId]);
    const bobDraft = await media.draft(bob.id);
    const bobUpload = await media.verified(bob.id, bobDraft);
    await publish(bob, bobDraft, 'ボブ', [bobUpload.uploadId]);

    await new PostgresUserRepository(sql).deleteById(alice.id);

    expect(await imagesOf(aliceDraft)).toHaveLength(0);
    expect(await imagesOf(bobDraft)).toHaveLength(1);
    const jobs = await sql`SELECT storage_key FROM twitter.media_delete_jobs WHERE storage_key = ANY(${[aliceUpload.storageKey, bobUpload.storageKey]})`;
    expect(jobs.map((j) => j.storage_key)).toEqual([aliceUpload.storageKey]);
    const [upload] = await sql`SELECT status FROM twitter.media_uploads WHERE id = ${aliceUpload.uploadId}`;
    expect(upload.status).toBe('deleting');
  });
});

describe('PostgresMediaRepository.reserveUpload', () => {
  it('同時に5枚予約しても、使用中は4枚までにする', async () => {
    const alice = await users.user('アリス', 'Tw');
    const draftId = await media.draft(alice.id);

    const results = await Promise.all(Array.from({ length: 5 }, () => media.reserved(alice.id, draftId)));

    expect(results.map((r) => r.outcome).sort()).toEqual([
      'limit-reached',
      'reserved',
      'reserved',
      'reserved',
      'reserved',
    ]);
  });

  it('他人・期限切れ・存在しない下書きには予約しない', async () => {
    const alice = await users.user('アリス', 'Tw');
    const bob = await users.user('ボブ', 'Tw');
    const draftId = await media.draft(alice.id);
    const expired = await media.draft(alice.id, new Date(NOW.getTime() - 25 * 3600_000));

    expect((await media.reserved(bob.id, draftId)).outcome).toBe('forbidden');
    expect((await media.reserved(alice.id, expired)).outcome).toBe('draft-closed');
    expect(
      await media.media.reserveUpload({
        actorId: alice.id,
        draftId: randomUUID(),
        uploadId: randomUUID(),
        storageKey: `tweet-uploads/x/${randomUUID()}`,
        tokenValidUntil: NOW,
        now: NOW,
      }),
    ).toBe('draft-not-found');
  });
});

describe('PostgresTweetWriter.discardDraft', () => {
  it('本人の未投稿の下書きを破棄し、画像の削除をトークンの期限後に予約する', async () => {
    const alice = await users.user('アリス', 'Tw');
    const bob = await users.user('ボブ', 'Tw');
    const draftId = await media.draft(alice.id);
    const upload = await media.verified(alice.id, draftId);

    expect(await media.writer.discardDraft({ actorId: bob.id, draftId, now: NOW })).toBe('forbidden');
    expect(await media.writer.discardDraft({ actorId: alice.id, draftId, now: NOW })).toBe('discarded');

    const [job] = await sql`SELECT not_before FROM twitter.media_delete_jobs WHERE storage_key = ${upload.storageKey}`;
    const [row] = await sql`SELECT token_valid_until, status FROM twitter.media_uploads WHERE id = ${upload.uploadId}`;
    expect(row.status).toBe('discarded');
    expect(job.not_before).toEqual(row.token_valid_until);
  });

  it('投稿済みの下書きは破棄しない', async () => {
    const alice = await users.user('アリス', 'Tw');
    const draftId = await media.draft(alice.id);
    await publish(alice, draftId, '投稿済み');

    expect(await media.writer.discardDraft({ actorId: alice.id, draftId, now: NOW })).toBe('published');
  });
});
