import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { MediaFixtures, PNG_IMAGE } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let users: TimelineFixtures;
let media: MediaFixtures;
const NOW = new Date();
const later = (ms: number) => new Date(NOW.getTime() + ms);

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

describe('PostgresMediaRepository（回収）', () => {
  it('reservedのものだけをverifiedにし、破棄済みは戻さない', async () => {
    const alice = await users.user('アリス', 'Mc');
    const draftId = await media.draft(alice.id);
    const upload = await media.reserved(alice.id, draftId);
    await media.media.discardUpload({ actorId: alice.id, uploadId: upload.uploadId, now: NOW });

    expect(
      await media.media.markVerified({ actorId: alice.id, uploadId: upload.uploadId, image: PNG_IMAGE, now: NOW }),
    ).toBe('not-reservable');
    const [row] = await sql`SELECT status FROM twitter.media_uploads WHERE id = ${upload.uploadId}`;
    expect(row.status).toBe('discarded');
  });

  it('本人以外の予約は検証用に取得できない', async () => {
    const alice = await users.user('アリス', 'Mc');
    const bob = await users.user('ボブ', 'Mc');
    const upload = await media.reserved(alice.id, await media.draft(alice.id));

    expect(await media.media.findOwnedUpload({ actorId: bob.id, uploadId: upload.uploadId, now: NOW })).toEqual({
      status: 'forbidden',
    });
    expect(
      await media.media.findOwnedUpload({ actorId: alice.id, uploadId: upload.uploadId, now: NOW }),
    ).toMatchObject({ status: 'found', upload: { storageKey: upload.storageKey, status: 'reserved' } });
  });

  it('期限切れの下書きを破棄して削除予約を作り、時期が来たものだけを取得する', async () => {
    const alice = await users.user('アリス', 'Mc');
    const draftId = await media.draft(alice.id, NOW, 1000);
    const upload = await media.verified(alice.id, draftId, NOW);

    expect(await media.media.discardExpiredDrafts({ now: later(2000), limit: 100 })).toBeGreaterThanOrEqual(1);
    const [draft] = await sql`SELECT status FROM twitter.tweet_drafts WHERE id = ${draftId}`;
    expect(draft.status).toBe('discarded');
    // トークンの期限（15分）前は削除しない
    expect(await media.media.claimDueDeleteJobs({ now: later(2000), limit: 1000 })).not.toContain(upload.storageKey);
    expect(await media.media.claimDueDeleteJobs({ now: later(16 * 60_000), limit: 1000 })).toContain(upload.storageKey);
  });

  it('削除の完了で予約と管理行を消し、失敗は試行回数と次回時刻を記録して残す', async () => {
    const alice = await users.user('アリス', 'Mc');
    const draftId = await media.draft(alice.id);
    const a = await media.verified(alice.id, draftId);
    const b = await media.verified(alice.id, draftId);
    await media.writer.discardDraft({ actorId: alice.id, draftId, now: NOW });

    await media.media.completeDeleteJob(a.storageKey);
    await media.media.failDeleteJob(b.storageKey, { errorCode: 'STORAGE_ERROR', nextAttemptAt: later(3600_000) });

    expect(await sql`SELECT 1 FROM twitter.media_delete_jobs WHERE storage_key = ${a.storageKey}`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM twitter.media_uploads WHERE id = ${a.uploadId}`).toHaveLength(0);
    const [job] = await sql`SELECT attempts, last_error_code FROM twitter.media_delete_jobs WHERE storage_key = ${b.storageKey}`;
    expect(job).toEqual({ attempts: 1, last_error_code: 'STORAGE_ERROR' });
    expect(await media.media.claimDueDeleteJobs({ now: later(20 * 60_000), limit: 1000 })).not.toContain(b.storageKey);
  });

  it('公開中・有効な下書きで使用中の実体だけを保持対象にする', async () => {
    const alice = await users.user('アリス', 'Mc');
    const publishedDraft = await media.draft(alice.id);
    const published = await media.verified(alice.id, publishedDraft);
    await media.writer.publish({
      actorId: alice.id,
      draftId: publishedDraft,
      value: { content: '', uploadIds: [published.uploadId] },
      fingerprint: 'x',
      now: NOW,
    });
    const openDraft = await media.draft(alice.id);
    const pending = await media.reserved(alice.id, openDraft);
    const discarded = await media.verified(alice.id, openDraft);
    await media.media.discardUpload({ actorId: alice.id, uploadId: discarded.uploadId, now: NOW });

    const kept = await media.media.findKeptStorageKeys([
      published.storageKey,
      pending.storageKey,
      discarded.storageKey,
      'tweet-uploads/unknown/key',
    ]);

    expect([...kept].sort()).toEqual([published.storageKey, pending.storageKey].sort());
  });

  it('公開済みの投稿の画像だけを配信用に返し、アカウント削除後は返さない', async () => {
    const alice = await users.user('アリス', 'Mc');
    const draftId = await media.draft(alice.id);
    const upload = await media.verified(alice.id, draftId);
    const unpublished = await media.verified(alice.id, await media.draft(alice.id));
    await media.writer.publish({
      actorId: alice.id,
      draftId,
      value: { content: '', uploadIds: [upload.uploadId] },
      fingerprint: 'x',
      now: NOW,
    });
    const [{ id: imageId }] = await sql`SELECT id FROM twitter.images WHERE upload_id = ${upload.uploadId}`;

    expect(await media.media.findPublishedImage(imageId)).toEqual({
      storageKey: upload.storageKey,
      contentType: 'image/png',
      size: PNG_IMAGE.size,
    });
    expect(await media.media.findPublishedImage(unpublished.uploadId)).toBeNull();

    await new PostgresUserRepository(sql).deleteById(alice.id);
    expect(await media.media.findPublishedImage(imageId)).toBeNull();
    // 削除予約の時刻はDBサーバーのnow()で入るため、手元の時計とのずれを見込んで十分先の時刻で確認する。
    // 削除予約は画像のトークンの期限（15分）以降になる。
    expect(await media.media.claimDueDeleteJobs({ now: later(20 * 60_000), limit: 1000 })).toContain(upload.storageKey);
  });
});
