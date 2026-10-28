import { describe, expect, it, vi } from 'vitest';
import { cleanupMedia } from '@/application/media/cleanup-media';
import { discardImageUpload } from '@/application/media/discard-image-upload';
import { reserveImageUpload } from '@/application/media/reserve-image-upload';
import { verifyImageUpload } from '@/application/media/verify-image-upload';
import { beginTweetDraft } from '@/application/tweets/begin-tweet-draft';
import { createTweet } from '@/application/tweets/create-tweet';
import {
  FakeImageInspector,
  FakeMediaStorage,
  GIF_BYTES,
  JPEG_BYTES,
  PNG_BYTES,
} from '@/test/support/fake-media-storage';
import { InMemoryTweetStore } from '@/test/support/in-memory-tweet-writer';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const NOW = new Date('2026-10-26T03:00:00.000Z');
const MB5 = 5 * 1024 * 1024;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup() {
  const store = new InMemoryTweetStore();
  const storage = new FakeMediaStorage();
  const inspector = new FakeImageInspector();
  let seq = 100;
  let now = NOW;
  const deps = {
    tweets: store,
    media: store,
    storage,
    inspector,
    newId: () => uuid(seq++),
    now: () => now,
  };
  const setNow = (date: Date) => (now = date);
  return { store, storage, inspector, deps, setNow };
}

async function draftFor(deps: ReturnType<typeof setup>['deps'], actorId = ALICE) {
  const result = await beginTweetDraft(deps, { actorId });
  if (!result.ok) throw new Error(result.code);
  return result.draftId;
}

async function reserve(deps: ReturnType<typeof setup>['deps'], draftId: string, actorId = ALICE) {
  const result = await reserveImageUpload(deps, { actorId, draftId, contentType: 'image/png', size: 100 });
  if (!result.ok) throw new Error(result.code);
  return result;
}

describe('reserveImageUpload', () => {
  it('サーバーで生成したパスに限定し、サイズ・形式・期限・上書き禁止を付けたトークンを発行する', async () => {
    const { deps, storage, store } = setup();
    const draftId = await draftFor(deps);

    const result = await reserveImageUpload(deps, {
      actorId: ALICE,
      draftId,
      contentType: 'image/jpeg',
      size: 1234,
    });

    expect(result).toEqual({
      ok: true,
      uploadId: uuid(101),
      pathname: `tweet-uploads/${draftId}/${uuid(101)}`,
      token: `token-for:tweet-uploads/${draftId}/${uuid(101)}`,
    });
    expect(storage.tokens).toEqual([
      {
        pathname: `tweet-uploads/${draftId}/${uuid(101)}`,
        maximumSizeInBytes: MB5,
        allowedContentTypes: ['image/jpeg', 'image/png'],
        validUntil: new Date(NOW.getTime() + 15 * 60 * 1000),
      },
    ]);
    expect(store.uploads.get(uuid(101))).toMatchObject({ status: 'reserved', ownerId: ALICE });
  });

  it.each([
    ['GIF', 'image/gif', 100],
    ['SVG', 'image/svg+xml', 100],
    ['5MB超過', 'image/png', MB5 + 1],
  ])('申告が%sなら予約・トークン発行をしない', async (_label, contentType, size) => {
    const { deps, storage, store } = setup();
    const draftId = await draftFor(deps);

    const result = await reserveImageUpload(deps, { actorId: ALICE, draftId, contentType, size });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_IMAGE' });
    expect(storage.tokens).toHaveLength(0);
    expect(store.uploads.size).toBe(0);
  });

  it('未ログイン・他人の下書き・期限切れの下書きではトークンを発行しない', async () => {
    const { deps, storage, store, setNow } = setup();
    const draftId = await draftFor(deps, ALICE);
    const input = { draftId, contentType: 'image/png', size: 100 };

    expect(await reserveImageUpload(deps, { ...input, actorId: null })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await reserveImageUpload(deps, { ...input, actorId: BOB })).toEqual({ ok: false, code: 'FORBIDDEN' });
    setNow(new Date(NOW.getTime() + 24 * 3600_000));
    expect(await reserveImageUpload(deps, { ...input, actorId: ALICE })).toEqual({ ok: false, code: 'DRAFT_EXPIRED' });
    expect(storage.tokens).toHaveLength(0);
    expect(store.uploads.size).toBe(0);
  });

  it('使用中の画像が4枚に達したら5枚目のトークンを発行しない。解除した分は新しいIDで予約できる', async () => {
    const { deps, storage } = setup();
    const draftId = await draftFor(deps);
    const reserved = [];
    for (let i = 0; i < 4; i++) reserved.push(await reserve(deps, draftId));

    expect(
      await reserveImageUpload(deps, { actorId: ALICE, draftId, contentType: 'image/png', size: 100 }),
    ).toEqual({ ok: false, code: 'LIMIT_REACHED' });
    await discardImageUpload(deps, { actorId: ALICE, uploadId: reserved[0].uploadId });
    const again = await reserve(deps, draftId);

    expect(again.uploadId).not.toBe(reserved[0].uploadId);
    expect(storage.tokens).toHaveLength(5);
  });
});

describe('reserveImageUpload（クライアントが決めた予約ID）', () => {
  const CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';

  it('指定のIDで予約し、同じIDの再送では枠を増やさずトークンを発行し直す', async () => {
    const { deps, storage, store } = setup();
    const draftId = await draftFor(deps);
    const input = { actorId: ALICE, draftId, uploadId: CLIENT_ID.toUpperCase(), contentType: 'image/png', size: 100 };

    const first = await reserveImageUpload(deps, input);
    const resent = await reserveImageUpload(deps, input);

    expect(first).toMatchObject({ ok: true, uploadId: CLIENT_ID, pathname: `tweet-uploads/${draftId}/${CLIENT_ID}` });
    expect(resent).toEqual(first);
    expect(storage.tokens).toHaveLength(2);
    expect(store.uploads.size).toBe(1);
  });

  it('応答を失った予約も、そのIDで解放すれば枠が戻る', async () => {
    const { deps } = setup();
    const draftId = await draftFor(deps);
    const lost = [];
    for (let i = 0; i < 4; i++) {
      const uploadId = uuid(900 + i);
      await reserveImageUpload(deps, { actorId: ALICE, draftId, uploadId, contentType: 'image/png', size: 100 });
      lost.push(uploadId);
    }
    expect(
      await reserveImageUpload(deps, { actorId: ALICE, draftId, contentType: 'image/png', size: 100 }),
    ).toEqual({ ok: false, code: 'LIMIT_REACHED' });

    for (const uploadId of lost) await discardImageUpload(deps, { actorId: ALICE, uploadId });

    expect(await reserveImageUpload(deps, { actorId: ALICE, draftId, contentType: 'image/png', size: 100 })).toMatchObject({
      ok: true,
    });
  });

  it('UUIDでないID、他人・別の下書き・破棄済みのIDでは予約しない', async () => {
    const { deps, storage } = setup();
    const draftId = await draftFor(deps);
    const otherDraft = await draftFor(deps);
    const bobsDraft = await draftFor(deps, BOB);
    const used = await reserve(deps, draftId);
    const discarded = await reserve(deps, draftId);
    await discardImageUpload(deps, { actorId: ALICE, uploadId: discarded.uploadId });
    const tokens = storage.tokens.length;
    const base = { actorId: ALICE, draftId, contentType: 'image/png', size: 100 };

    expect(await reserveImageUpload(deps, { ...base, uploadId: 'not-a-uuid' })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(await reserveImageUpload(deps, { ...base, draftId: otherDraft, uploadId: used.uploadId })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(await reserveImageUpload(deps, { ...base, uploadId: discarded.uploadId })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(
      await reserveImageUpload(deps, { ...base, actorId: BOB, draftId: bobsDraft, uploadId: used.uploadId }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(storage.tokens).toHaveLength(tokens);
  });

  it('トークンを発行できなければ、予約を解放して枠を空ける', async () => {
    const { deps, storage, store } = setup();
    const draftId = await draftFor(deps);
    vi.spyOn(storage, 'createUploadToken').mockRejectedValueOnce(new Error('blob down'));

    const result = await reserveImageUpload(deps, { actorId: ALICE, draftId, contentType: 'image/png', size: 100 });

    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect([...store.uploads.values()].map((u) => u.status)).toEqual(['discarded']);
  });
});

describe('verifyImageUpload', () => {
  async function uploaded(bytes: Uint8Array, contentType: string, actorId = ALICE) {
    const context = setup();
    const draftId = await draftFor(context.deps, actorId);
    const { uploadId, pathname } = await reserve(context.deps, draftId, actorId);
    context.storage.put(pathname, bytes, contentType);
    return { ...context, draftId, uploadId, pathname };
  }

  it('実体から測ったサイズ・形式・寸法でverifiedにする', async () => {
    const { deps, store, uploadId } = await uploaded(JPEG_BYTES(MB5), 'image/jpeg');

    const result = await verifyImageUpload(deps, { actorId: ALICE, uploadId });

    expect(result).toEqual({ ok: true, upload: { id: uploadId, width: 100, height: 80 } });
    expect(store.uploads.get(uploadId)).toMatchObject({
      status: 'verified',
      image: { size: MB5, contentType: 'image/jpeg', width: 100, height: 80 },
    });
  });

  it.each([
    ['Content-Typeの偽装（中身はJPEG）', () => JPEG_BYTES(), 'image/png'],
    ['拡張子・形式の偽装（中身はGIF）', () => GIF_BYTES(), 'image/png'],
    ['壊れた画像', () => new Uint8Array([1, 2, 3]), 'image/png'],
    ['許可していない形式', () => PNG_BYTES(), 'image/webp'],
  ])('%sは拒否し、verifiedにしない', async (_label, bytes, contentType) => {
    const { deps, store, uploadId } = await uploaded(bytes(), contentType);

    const result = await verifyImageUpload(deps, { actorId: ALICE, uploadId });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_IMAGE' });
    expect(store.uploads.get(uploadId)?.status).toBe('reserved');
  });

  it('サイズ超過は上限を超えて読み込まずに拒否する', async () => {
    const { deps, storage, uploadId } = await uploaded(PNG_BYTES(MB5 + 1), 'image/png');

    const result = await verifyImageUpload(deps, { actorId: ALICE, uploadId });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_IMAGE', message: '画像は1枚5MB以下にしてください' });
    expect(storage.bytesRead).toBe(0);
  });

  it('メタデータより実体が大きくても、上限を超えた時点で読み取りを中断する', async () => {
    const { deps, storage, uploadId } = await uploaded(PNG_BYTES(MB5 + 200_000), 'image/png');
    vi.spyOn(storage, 'inspect').mockResolvedValue({ size: 100, contentType: 'image/png' });

    const result = await verifyImageUpload(deps, { actorId: ALICE, uploadId });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_IMAGE' });
    // ストリームの先読み（最大2チャンク）を除き、上限を超えて読み進めない。
    expect(storage.bytesRead).toBeLessThanOrEqual(MB5 + 2 * 64 * 1024);
    expect(storage.bytesRead).toBeLessThan(MB5 + 200_000);
  });

  it('画素数が上限を超えたら拒否する', async () => {
    const { deps, inspector, uploadId } = await uploaded(PNG_BYTES(), 'image/png');
    inspector.size = { width: 10_000, height: 4_001 };

    expect(await verifyImageUpload(deps, { actorId: ALICE, uploadId })).toMatchObject({
      ok: false,
      code: 'INVALID_IMAGE',
      message: '画像の画素数が大きすぎます',
    });
  });

  it('他人の予約・存在しない予約・アップロード前は検証しない', async () => {
    const { deps, store, uploadId, storage, pathname } = await uploaded(PNG_BYTES(), 'image/png');

    expect(await verifyImageUpload(deps, { actorId: BOB, uploadId })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await verifyImageUpload(deps, { actorId: ALICE, uploadId: uuid(999) })).toEqual({ ok: false, code: 'NOT_FOUND' });
    storage.objects.delete(pathname);
    expect(await verifyImageUpload(deps, { actorId: ALICE, uploadId })).toEqual({ ok: false, code: 'NOT_UPLOADED' });
    expect(store.uploads.get(uploadId)?.status).toBe('reserved');
  });

  it('破棄済みの予約はverifiedへ戻さない（遅れて届いた検証要求を含む）', async () => {
    const { deps, store, uploadId } = await uploaded(PNG_BYTES(), 'image/png');
    await discardImageUpload(deps, { actorId: ALICE, uploadId });

    expect(await verifyImageUpload(deps, { actorId: ALICE, uploadId })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(store.uploads.get(uploadId)?.status).toBe('discarded');
  });

  it('ストレージ障害はUNAVAILABLEにする', async () => {
    const { deps, storage, uploadId } = await uploaded(PNG_BYTES(), 'image/png');
    vi.spyOn(storage, 'inspect').mockRejectedValue(new Error('down'));

    expect(await verifyImageUpload(deps, { actorId: ALICE, uploadId })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('discardImageUpload', () => {
  it('本人の未投稿の画像だけを破棄し、トークンの期限後に削除を予約する', async () => {
    const { deps, store } = setup();
    const draftId = await draftFor(deps);
    const { uploadId, pathname } = await reserve(deps, draftId);

    expect(await discardImageUpload(deps, { actorId: BOB, uploadId })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await discardImageUpload(deps, { actorId: ALICE, uploadId })).toEqual({ ok: true });
    expect(store.deleteJobs.get(pathname)?.notBefore).toEqual(new Date(NOW.getTime() + 15 * 60 * 1000));
  });

  it('投稿済みの画像は破棄しない', async () => {
    const { deps, store, storage } = setup();
    const draftId = await draftFor(deps);
    const { uploadId, pathname } = await reserve(deps, draftId);
    storage.put(pathname, PNG_BYTES(), 'image/png');
    await verifyImageUpload(deps, { actorId: ALICE, uploadId });
    await createTweet(deps, { actorId: ALICE, draftId, input: { content: '', uploadIds: [uploadId] } });

    expect(await discardImageUpload(deps, { actorId: ALICE, uploadId })).toEqual({ ok: false, code: 'ATTACHED' });
    expect(store.uploads.get(uploadId)?.status).toBe('attached');
  });
});

describe('cleanupMedia', () => {
  it('期限切れの下書きを破棄し、時期が来た削除予約の実体を消す。再実行しても正常に終わる', async () => {
    const { deps, store, storage, setNow } = setup();
    const draftId = await draftFor(deps);
    const { uploadId, pathname } = await reserve(deps, draftId);
    storage.put(pathname, PNG_BYTES(), 'image/png');

    setNow(new Date(NOW.getTime() + 24 * 3600_000));
    const first = await cleanupMedia(deps, {});
    const second = await cleanupMedia(deps, {});

    expect(first).toMatchObject({ expiredDrafts: 1, deleted: 1, failed: 0 });
    expect(second).toMatchObject({ expiredDrafts: 0, deleted: 0, failed: 0 });
    expect(store.drafts.get(draftId)?.status).toBe('discarded');
    expect(storage.objects.has(pathname)).toBe(false);
    expect(store.uploads.has(uploadId)).toBe(false);
    expect(store.deleteJobs.size).toBe(0);
  });

  it('トークンの期限前の削除予約は実行しない', async () => {
    const { deps, store, storage } = setup();
    const draftId = await draftFor(deps);
    const { uploadId, pathname } = await reserve(deps, draftId);
    storage.put(pathname, PNG_BYTES(), 'image/png');
    await discardImageUpload(deps, { actorId: ALICE, uploadId });

    expect(await cleanupMedia(deps, {})).toMatchObject({ deleted: 0 });
    expect(storage.objects.has(pathname)).toBe(true);
    expect(store.deleteJobs.has(pathname)).toBe(true);
  });

  it('ストレージ障害では削除予約を失わず、後で再試行する', async () => {
    const { deps, store, storage, setNow } = setup();
    const draftId = await draftFor(deps);
    const { pathname } = await reserve(deps, draftId);
    storage.put(pathname, PNG_BYTES(), 'image/png');
    setNow(new Date(NOW.getTime() + 24 * 3600_000));
    storage.failRemove = true;

    const failed = await cleanupMedia(deps, {});
    expect(failed).toMatchObject({ deleted: 0 });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    expect(store.deleteJobs.get(pathname)).toMatchObject({ attempts: 1, lastErrorCode: 'STORAGE_ERROR' });

    storage.failRemove = false;
    setNow(new Date(NOW.getTime() + 25 * 3600_000));
    expect(await cleanupMedia(deps, {})).toMatchObject({ deleted: 1, failed: 0 });
    expect(store.deleteJobs.size).toBe(0);
  });

  it('アカウント削除で消えた画像の実体を回収する', async () => {
    const { deps, store, storage } = setup();
    const draftId = await draftFor(deps);
    const { uploadId, pathname } = await reserve(deps, draftId);
    storage.put(pathname, PNG_BYTES(), 'image/png');
    await verifyImageUpload(deps, { actorId: ALICE, uploadId });
    await createTweet(deps, { actorId: ALICE, draftId, input: { content: '', uploadIds: [uploadId] } });
    const imageId = store.images[0].id;

    store.deleteUser(ALICE, NOW);
    expect(await store.findPublishedImage(imageId)).toBeNull();
    await cleanupMedia(deps, {});

    expect(storage.objects.has(pathname)).toBe(false);
  });

  it('管理パス配下の24時間以上古い孤立した実体だけを削除し、使用中・新しい・管理外のものは残す', async () => {
    const { deps, storage } = setup();
    const draftId = await draftFor(deps);
    const { pathname: inUse } = await reserve(deps, draftId);
    const old = new Date(NOW.getTime() - 25 * 3600_000);
    storage.put(inUse, PNG_BYTES(), 'image/png', old);
    storage.put('tweet-uploads/x/orphan', PNG_BYTES(), 'image/png', old);
    storage.put('tweet-uploads/x/recent', PNG_BYTES(), 'image/png', NOW);
    storage.put('other/old', PNG_BYTES(), 'image/png', old);

    expect(await cleanupMedia(deps, {})).toMatchObject({ orphans: 1 });
    expect([...storage.objects.keys()].sort()).toEqual([inUse, 'other/old', 'tweet-uploads/x/recent'].sort());
  });
});
