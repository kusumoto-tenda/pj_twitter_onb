import { randomUUID } from 'node:crypto';
import { put as clientPut } from '@vercel/blob/client';
import postgres from 'postgres';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanupMedia } from '@/application/media/cleanup-media';
import { discardImageUpload } from '@/application/media/discard-image-upload';
import { reserveImageUpload } from '@/application/media/reserve-image-upload';
import { verifyImageUpload } from '@/application/media/verify-image-upload';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { beginTweetDraft } from '@/application/tweets/begin-tweet-draft';
import { createTweet } from '@/application/tweets/create-tweet';
import { SharpImageInspector } from '@/infra/media/sharp-image-inspector';
import { VercelBlobStorage } from '@/infra/media/vercel-blob-storage';
import { PostgresMediaRepository } from '@/infra/repositories/postgres-media-repository';
import { PostgresTweetWriter } from '@/infra/repositories/postgres-tweet-writer';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { requireTestBlobEnvironment } from '@/test/support/blob-environment';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

// 実体を作る前に、テスト用ストアであることを確認する。
const { token } = requireTestBlobEnvironment(process.env);
const storage = new VercelBlobStorage(token);
let sql: postgres.Sql;
let users: TimelineFixtures;
let png: Buffer;
const createdKeys: string[] = [];
const createdDrafts: string[] = [];

function depsAt(now: () => Date) {
  return {
    tweets: new PostgresTweetWriter(sql),
    media: new PostgresMediaRepository(sql),
    storage,
    inspector: new SharpImageInspector(),
    newId: randomUUID,
    now,
  };
}

/** 実ストアへ画像を上げて検証済みにし、ストレージキーとuploadIdを返す。 */
async function uploadVerified(deps: ReturnType<typeof depsAt>, actor: TimelinePerson, draftId: string) {
  const reserved = await reserveImageUpload(deps, { actorId: actor.id, draftId, contentType: 'image/png', size: png.byteLength });
  if (!reserved.ok) throw new Error(reserved.code);
  createdKeys.push(reserved.pathname);
  await clientPut(reserved.pathname, png, { access: 'private', token: reserved.token, contentType: 'image/png' });
  const verified = await verifyImageUpload(deps, { actorId: actor.id, uploadId: reserved.uploadId });
  if (!verified.ok) throw new Error(verified.code);
  return reserved;
}

async function newDraft(deps: ReturnType<typeof depsAt>, actor: TimelinePerson) {
  const draft = await beginTweetDraft(deps, { actorId: actor.id });
  if (!draft.ok) throw new Error(draft.code);
  createdDrafts.push(draft.draftId);
  return draft.draftId;
}

beforeAll(async () => {
  sql = await connectTestDatabase();
  users = new TimelineFixtures(sql);
  png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#22aa66' } }).png().toBuffer();
});

afterEach(async () => {
  await users.cleanup();
  if (createdDrafts.length > 0) {
    const ids = createdDrafts.splice(0);
    await sql`DELETE FROM twitter.images WHERE tweet_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM twitter.media_delete_jobs WHERE storage_key IN (SELECT storage_key FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[]))`;
    await sql`DELETE FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM twitter.tweet_drafts WHERE id = ANY(${ids}::uuid[])`;
  }
});

afterAll(async () => {
  if (createdKeys.length > 0) await storage.remove(createdKeys);
  await sql.end();
});

describe('画像のライフサイクル（実DB・実テスト用ストア）', () => {
  it('アカウント削除で画像の配信は直ちに止まり、回収で実体が消える。他人の画像は残る', async () => {
    const deps = depsAt(() => new Date());
    const alice = await users.user('アリス', 'Ml');
    const bob = await users.user('ボブ', 'Ml');
    const aliceDraft = await newDraft(deps, alice);
    const aliceUpload = await uploadVerified(deps, alice, aliceDraft);
    await createTweet(deps, { actorId: alice.id, draftId: aliceDraft, input: { content: '', uploadIds: [aliceUpload.uploadId] } });
    const bobDraft = await newDraft(deps, bob);
    const bobUpload = await uploadVerified(deps, bob, bobDraft);
    await createTweet(deps, { actorId: bob.id, draftId: bobDraft, input: { content: 'ボブ', uploadIds: [bobUpload.uploadId] } });
    const [{ id: aliceImage }] = await sql`SELECT id FROM twitter.images WHERE upload_id = ${aliceUpload.uploadId}`;
    expect(await deps.media.findPublishedImage(aliceImage)).not.toBeNull();

    await new PostgresUserRepository(sql).deleteById(alice.id);
    expect(await deps.media.findPublishedImage(aliceImage)).toBeNull();
    expect(await storage.inspect(aliceUpload.pathname)).not.toBeNull();

    // 削除予約はDBサーバーのnow()で入るため、少し先の時刻で回収する。
    await cleanupMedia(depsAt(() => new Date(Date.now() + 10 * 60_000)), { limit: 1000 });

    expect(await storage.inspect(aliceUpload.pathname)).toBeNull();
    expect(await storage.inspect(bobUpload.pathname)).not.toBeNull();
  }, 120_000);

  it('トークンの有効期間中に破棄した後で届いたアップロードも、期限後の回収で消える', async () => {
    const start = new Date();
    const deps = depsAt(() => start);
    const alice = await users.user('アリス', 'Ml');
    const draftId = await newDraft(deps, alice);
    const reserved = await reserveImageUpload(deps, { actorId: alice.id, draftId, contentType: 'image/png', size: png.byteLength });
    if (!reserved.ok) throw new Error(reserved.code);
    createdKeys.push(reserved.pathname);

    // 先に破棄し、その後でトークンを使ったアップロードが届く
    await discardImageUpload(deps, { actorId: alice.id, uploadId: reserved.uploadId });
    await clientPut(reserved.pathname, png, { access: 'private', token: reserved.token, contentType: 'image/png' });
    expect(await verifyImageUpload(deps, { actorId: alice.id, uploadId: reserved.uploadId })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    // トークンの期限前は削除しない
    await cleanupMedia(depsAt(() => new Date(start.getTime() + 60_000)), { limit: 1000 });
    expect(await storage.inspect(reserved.pathname)).not.toBeNull();

    await cleanupMedia(depsAt(() => new Date(start.getTime() + 16 * 60_000)), { limit: 1000 });
    expect(await storage.inspect(reserved.pathname)).toBeNull();
  }, 120_000);
});
