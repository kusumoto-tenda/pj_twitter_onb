import { describe, expect, it, vi } from 'vitest';
import { beginTweetDraft } from '@/application/usecases/tweets/begin-tweet-draft';
import { createTweet } from '@/application/usecases/tweets/create-tweet';
import { discardTweetDraft } from '@/application/usecases/tweets/discard-tweet-draft';
import { InMemoryTweetStore } from '@/test/support/in-memory-tweet-writer';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const NOW = new Date('2026-10-26T03:00:00.000Z');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup() {
  const store = new InMemoryTweetStore();
  let seq = 100;
  const deps = { tweets: store, newId: () => uuid(seq++), now: () => NOW };
  return { store, deps };
}

async function draftFor(deps: ReturnType<typeof setup>['deps'], actorId = ALICE) {
  const result = await beginTweetDraft(deps, { actorId });
  if (!result.ok) throw new Error(result.code);
  return result.draftId;
}

/** 下書きに検証済みの画像を用意する（予約〜検証の結果だけを再現）。 */
async function verifiedUpload(store: InMemoryTweetStore, draftId: string, n: number, ownerId = ALICE) {
  const uploadId = uuid(900 + n);
  await store.reserveUpload({
    actorId: ownerId,
    draftId,
    uploadId,
    storageKey: `tweet-uploads/${draftId}/${uploadId}`,
    tokenValidUntil: new Date(NOW.getTime() + 15 * 60 * 1000),
    now: NOW,
  });
  await store.markVerified({
    actorId: ownerId,
    uploadId,
    image: { size: 100, contentType: 'image/png', width: 10, height: 10 },
    now: NOW,
  });
  return uploadId;
}

describe('beginTweetDraft', () => {
  it('ログイン中の利用者を所有者とする24時間有効の下書きを作る', async () => {
    const { store, deps } = setup();

    const result = await beginTweetDraft(deps, { actorId: ALICE });

    expect(result).toEqual({ ok: true, draftId: uuid(100), expiresAt: new Date(NOW.getTime() + 24 * 3600_000) });
    expect(store.drafts.get(uuid(100))).toMatchObject({ ownerId: ALICE, status: 'open' });
  });

  it('未ログインなら下書きを作らない', async () => {
    const { store, deps } = setup();

    expect(await beginTweetDraft(deps, { actorId: null })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(store.drafts.size).toBe(0);
  });
});

describe('createTweet', () => {
  it('本文だけの投稿を、下書きIDを投稿UUIDとして投稿日・編集日を同じ時刻で確定する', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);

    const result = await createTweet(deps, {
      actorId: ALICE,
      draftId,
      input: { content: '一行目\r\n二行目', uploadIds: [] },
    });

    expect(result).toEqual({ ok: true, tweetId: draftId });
    expect(store.tweets.get(draftId)).toEqual({
      id: draftId,
      ownerId: ALICE,
      content: '一行目\n二行目',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('画像だけの投稿・本文と画像の投稿を、選択順のまま確定する', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    const uploads = [await verifiedUpload(store, draftId, 2), await verifiedUpload(store, draftId, 1)];

    const result = await createTweet(deps, { actorId: ALICE, draftId, input: { content: '', uploadIds: uploads } });

    expect(result.ok).toBe(true);
    expect(store.images.map((i) => [i.uploadId, i.position])).toEqual([
      [uploads[0], 0],
      [uploads[1], 1],
    ]);
  });

  it('投稿に使わなかった予約・検証済みの画像は、確定と同時に破棄して削除を予約する', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    const used = await verifiedUpload(store, draftId, 1);
    const unusedVerified = await verifiedUpload(store, draftId, 2);
    const unusedReserved = uuid(960);
    await store.reserveUpload({
      actorId: ALICE,
      draftId,
      uploadId: unusedReserved,
      storageKey: `tweet-uploads/${draftId}/${unusedReserved}`,
      tokenValidUntil: new Date(NOW.getTime() + 15 * 60 * 1000),
      now: NOW,
    });

    await createTweet(deps, { actorId: ALICE, draftId, input: { content: '', uploadIds: [used] } });

    expect(store.uploads.get(used)?.status).toBe('attached');
    for (const uploadId of [unusedVerified, unusedReserved]) {
      expect(store.uploads.get(uploadId)?.status).toBe('discarded');
      expect(store.deleteJobs.has(store.uploads.get(uploadId)!.storageKey)).toBe(true);
    }
  });

  it('無効な入力は保存せずINVALID_INPUTを返す', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    const publish = vi.spyOn(store, 'publish');

    const result = await createTweet(deps, { actorId: ALICE, draftId, input: { content: '  ', uploadIds: [] } });

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { content: ['本文か画像のどちらかを入力してください'] },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('未ログインなら保存しない', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);

    expect(
      await createTweet(deps, { actorId: null, draftId, input: { content: 'a', uploadIds: [] } }),
    ).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(store.tweets.size).toBe(0);
  });

  it('別アカウントの下書き・削除済み利用者の下書きからは投稿しない', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps, ALICE);

    expect(
      await createTweet(deps, { actorId: BOB, draftId, input: { content: 'a', uploadIds: [] } }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    store.deleteUser(ALICE);
    expect(
      await createTweet(deps, { actorId: ALICE, draftId, input: { content: 'a', uploadIds: [] } }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(store.tweets.size).toBe(0);
  });

  it('期限切れ・破棄済み・存在しない下書きからは投稿しない', async () => {
    const { store, deps } = setup();
    const expired = await draftFor(deps);
    store.drafts.get(expired)!.expiresAt = NOW;
    const discarded = await draftFor(deps);
    await discardTweetDraft(deps, { actorId: ALICE, draftId: discarded });

    for (const draftId of [expired, discarded, uuid(999)]) {
      expect(
        await createTweet(deps, { actorId: ALICE, draftId, input: { content: 'a', uploadIds: [] } }),
      ).toEqual({ ok: false, code: 'DRAFT_EXPIRED' });
    }
    expect(store.tweets.size).toBe(0);
  });

  it('未検証・他人・別の下書きの画像では投稿しない', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    const otherDraft = await draftFor(deps);
    const bobDraft = await draftFor(deps, BOB);
    const unverified = uuid(950);
    await store.reserveUpload({
      actorId: ALICE,
      draftId,
      uploadId: unverified,
      storageKey: 'k',
      tokenValidUntil: NOW,
      now: NOW,
    });
    const fromOtherDraft = await verifiedUpload(store, otherDraft, 3);
    const bobs = await verifiedUpload(store, bobDraft, 4, BOB);

    for (const uploadId of [unverified, fromOtherDraft, bobs, uuid(951)]) {
      expect(
        await createTweet(deps, { actorId: ALICE, draftId, input: { content: 'a', uploadIds: [uploadId] } }),
      ).toEqual({ ok: false, code: 'UPLOAD_NOT_READY' });
    }
    expect(store.tweets.size).toBe(0);
  });

  it('同じ下書き・同じ内容の再送は同じ投稿を返し、投稿を増やさない', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    const input = { content: 'こんにちは', uploadIds: [] };

    const first = await createTweet(deps, { actorId: ALICE, draftId, input });
    const second = await createTweet(deps, { actorId: ALICE, draftId, input: { ...input, content: 'こんにちは' } });

    expect(second).toEqual(first);
    expect(store.tweets.size).toBe(1);
  });

  it('同じ下書きで異なる内容の再送はCONFLICTにする（本人確認なしに既存結果を返さない）', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    await createTweet(deps, { actorId: ALICE, draftId, input: { content: '最初', uploadIds: [] } });

    expect(
      await createTweet(deps, { actorId: ALICE, draftId, input: { content: '別の内容', uploadIds: [] } }),
    ).toEqual({ ok: false, code: 'CONFLICT' });
    expect(
      await createTweet(deps, { actorId: BOB, draftId, input: { content: '最初', uploadIds: [] } }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(store.tweets.get(draftId)?.content).toBe('最初');
  });

  it('保存の例外はUNAVAILABLEにする', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    vi.spyOn(store, 'publish').mockRejectedValue(new Error('db down'));

    expect(
      await createTweet(deps, { actorId: ALICE, draftId, input: { content: 'a', uploadIds: [] } }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('discardTweetDraft', () => {
  it('本人の未投稿の下書きだけを破棄し、画像の削除を予約する', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    const uploadId = await verifiedUpload(store, draftId, 1);

    expect(await discardTweetDraft(deps, { actorId: BOB, draftId })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await discardTweetDraft(deps, { actorId: ALICE, draftId })).toEqual({ ok: true });
    expect(store.drafts.get(draftId)?.status).toBe('discarded');
    expect(store.uploads.get(uploadId)?.status).toBe('discarded');
    expect(store.deleteJobs.has(store.uploads.get(uploadId)!.storageKey)).toBe(true);
  });

  it('投稿済みの下書きは破棄しない', async () => {
    const { store, deps } = setup();
    const draftId = await draftFor(deps);
    const uploadId = await verifiedUpload(store, draftId, 1);
    await createTweet(deps, { actorId: ALICE, draftId, input: { content: '', uploadIds: [uploadId] } });

    expect(await discardTweetDraft(deps, { actorId: ALICE, draftId })).toEqual({ ok: false, code: 'PUBLISHED' });
    expect(store.uploads.get(uploadId)?.status).toBe('attached');
    expect(store.deleteJobs.size).toBe(0);
  });
});
