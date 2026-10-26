import { describe, expect, it, vi } from 'vitest';
import type { CommitEditOutcome, PrepareEditOutcome } from '@/application/tweets/ports/tweet-editor';
import { beginTweetEdit } from '@/application/tweets/begin-tweet-edit';
import { updateTweet } from '@/application/tweets/update-tweet';

const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const TWEET = '00000000-0000-4000-8000-0000000000d1';
const DRAFT = '00000000-0000-4000-8000-0000000000e1';
const NOW = new Date('2026-10-26T03:00:00.000Z');
const IMAGE = '00000000-0000-4000-8000-0000000000c1';
const UPLOAD = '00000000-0000-4000-8000-0000000000f1';

function editor(prepare?: PrepareEditOutcome, commit?: CommitEditOutcome) {
  return {
    prepare: vi.fn(async (_input: unknown): Promise<PrepareEditOutcome> => prepare ?? { status: 'not-found' }),
    commit: vi.fn(
      async (_input: unknown): Promise<CommitEditOutcome> =>
        commit ?? { status: 'updated', tweetId: TWEET, replayed: false },
    ),
  };
}

describe('beginTweetEdit', () => {
  it('サーバーで下書きIDと24時間の期限を決め、現在の投稿内容を返す', async () => {
    const value = { draftId: DRAFT, tweetId: TWEET, content: '元の本文', images: [] };
    const deps = { editor: editor({ status: 'ready', value }), newId: () => DRAFT, now: () => NOW };

    expect(await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET })).toEqual({ ok: true, value });
    expect(deps.editor.prepare).toHaveBeenCalledWith({
      actorId: ACTOR,
      tweetId: TWEET,
      draftId: DRAFT,
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 24 * 3600_000),
    });
  });

  it('未ログインならDBを使わない。UUIDでない投稿IDはNOT_FOUND', async () => {
    const deps = { editor: editor(), newId: () => DRAFT, now: () => NOW };

    expect(await beginTweetEdit(deps, { actorId: null, tweetId: TWEET })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await beginTweetEdit(deps, { actorId: ACTOR, tweetId: 'nope' })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(deps.editor.prepare).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', 'NOT_FOUND'],
    ['forbidden', 'FORBIDDEN'],
  ] as const)('%s は %s にする', async (status, code) => {
    const deps = { editor: editor({ status }), newId: () => DRAFT, now: () => NOW };

    expect(await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET })).toEqual({ ok: false, code });
  });

  it('DB障害はUNAVAILABLEにする', async () => {
    const deps = { editor: editor(), newId: () => DRAFT, now: () => NOW };
    deps.editor.prepare.mockRejectedValue(new Error('db down'));

    expect(await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('updateTweet', () => {
  const input = { content: '新しい\r\n本文', keepImageIds: [IMAGE.toUpperCase()], uploadIds: [UPLOAD] };

  it('未ログインならcommitを呼ばない', async () => {
    const deps = { editor: editor(), now: () => NOW };

    expect(await updateTweet(deps, { actorId: null, draftId: DRAFT, input })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(deps.editor.commit).not.toHaveBeenCalled();
  });

  it('入力違反ならcommitを呼ばず欄エラーを返す', async () => {
    const deps = { editor: editor(), now: () => NOW };

    const result = await updateTweet(deps, { actorId: ACTOR, draftId: DRAFT, input: { content: ' ', keepImageIds: [], uploadIds: [] } });

    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT', fieldErrors: { content: [expect.any(String)] } });
    expect(deps.editor.commit).not.toHaveBeenCalled();
  });

  it('正規化した入力と、保持・新規を分けたfingerprintでcommitする', async () => {
    const deps = { editor: editor(), now: () => NOW };

    expect(await updateTweet(deps, { actorId: ACTOR, draftId: DRAFT, input })).toEqual({ ok: true, tweetId: TWEET });
    expect(deps.editor.commit).toHaveBeenCalledWith({
      actorId: ACTOR,
      draftId: DRAFT,
      value: { content: '新しい\n本文', keepImageIds: [IMAGE], uploadIds: [UPLOAD] },
      fingerprint: JSON.stringify(['新しい\n本文', [IMAGE], [UPLOAD]]),
      now: NOW,
    });
  });

  it('同じIDでも保持か新規かが違えば別のfingerprintにする', async () => {
    const deps = { editor: editor(), now: () => NOW };
    await updateTweet(deps, { actorId: ACTOR, draftId: DRAFT, input: { content: 'a', keepImageIds: [IMAGE], uploadIds: [] } });
    await updateTweet(deps, { actorId: ACTOR, draftId: DRAFT, input: { content: 'a', keepImageIds: [], uploadIds: [IMAGE] } });

    const [first, second] = deps.editor.commit.mock.calls.map((c) => (c[0] as { fingerprint: string }).fingerprint);
    expect(first).not.toBe(second);
  });

  it.each([
    [{ status: 'not-found' }, { ok: false, code: 'NOT_FOUND' }],
    [{ status: 'forbidden' }, { ok: false, code: 'FORBIDDEN' }],
    [{ status: 'draft-closed' }, { ok: false, code: 'DRAFT_EXPIRED' }],
    [{ status: 'conflict' }, { ok: false, code: 'CONFLICT' }],
    [{ status: 'upload-not-ready' }, { ok: false, code: 'UPLOAD_NOT_READY' }],
    [{ status: 'invalid-images' }, { ok: false, code: 'INVALID_INPUT', fieldErrors: { images: ['添付画像を確認してください'] } }],
    [{ status: 'updated', tweetId: TWEET, replayed: true }, { ok: true, tweetId: TWEET }],
  ] as const)('commitの結果 %o を変換する', async (outcome, expected) => {
    const deps = { editor: editor(undefined, outcome as CommitEditOutcome), now: () => NOW };

    expect(await updateTweet(deps, { actorId: ACTOR, draftId: DRAFT, input })).toEqual(expected);
  });

  it('commitの例外はUNAVAILABLEにする', async () => {
    const deps = { editor: editor(), now: () => NOW };
    deps.editor.commit.mockRejectedValue(new Error('db down'));

    expect(await updateTweet(deps, { actorId: ACTOR, draftId: DRAFT, input })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('編集の流れ（テスト用の実装で状態遷移を確認）', async () => {
  const { InMemoryTweetStore } = await import('@/test/support/in-memory-tweet-writer');
  const { InMemoryTweetEditor } = await import('@/test/support/in-memory-tweet-editor');
  const OTHER = '00000000-0000-4000-8000-0000000000b0';

  async function published(content: string, imageCount: number) {
    const store = new InMemoryTweetStore();
    const tweetEditor = new InMemoryTweetEditor(store);
    await store.createDraft({ id: TWEET, ownerId: ACTOR, expiresAt: new Date(NOW.getTime() + 3600_000), now: NOW });
    const uploadIds = [];
    for (let i = 0; i < imageCount; i++) {
      const uploadId = `00000000-0000-4000-8000-00000000090${i}`;
      await store.reserveUpload({ actorId: ACTOR, draftId: TWEET, uploadId, storageKey: `k/${i}`, tokenValidUntil: NOW, now: NOW });
      await store.markVerified({ actorId: ACTOR, uploadId, image: { size: 1, contentType: 'image/png', width: 10 + i, height: 1 }, now: NOW });
      uploadIds.push(uploadId);
    }
    await store.publish({ actorId: ACTOR, draftId: TWEET, value: { content, uploadIds }, fingerprint: 'x', now: NOW });
    let n = 0;
    const deps = { editor: tweetEditor, newId: () => `00000000-0000-4000-8000-0000000005${String(n++).padStart(2, '0')}`, now: () => NOW };
    return { store, tweetEditor, deps };
  }

  it('既存画像の一部を解除し、残りの順序を保って位置を詰め、版を進める', async () => {
    const { store, tweetEditor, deps } = await published('元の本文', 3);
    const begun = await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET });
    if (!begun.ok) throw new Error(begun.code);
    const [first, , third] = begun.value.images;

    const result = await updateTweet(deps, {
      actorId: ACTOR,
      draftId: begun.value.draftId,
      input: { content: '新しい本文', keepImageIds: [first.id, third.id], uploadIds: [] },
    });

    expect(result).toEqual({ ok: true, tweetId: TWEET });
    expect(store.images.filter((i) => i.tweetId === TWEET).sort((a, b) => a.position - b.position).map((i) => [i.id, i.position])).toEqual([
      [first.id, 0],
      [third.id, 1],
    ]);
    expect(store.tweets.get(TWEET)?.content).toBe('新しい本文');
    expect(tweetEditor.revision(TWEET)).toBe(1);
  });

  it('何も変えない保存は成功するが、版と編集日時は進めない', async () => {
    const { store, tweetEditor, deps } = await published('そのまま', 1);
    const begun = await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET });
    if (!begun.ok) throw new Error(begun.code);
    const later = { ...deps, now: () => new Date(NOW.getTime() + 60_000) };

    const result = await updateTweet(later, {
      actorId: ACTOR,
      draftId: begun.value.draftId,
      input: { content: 'そのまま', keepImageIds: begun.value.images.map((i) => i.id), uploadIds: [] },
    });

    expect(result.ok).toBe(true);
    expect(tweetEditor.revision(TWEET)).toBe(0);
    expect(store.tweets.get(TWEET)?.updatedAt).toEqual(NOW);
  });

  it('先に別の編集が確定していたら、後からの保存は競合にして何も変えない', async () => {
    const { store, deps } = await published('元', 0);
    const a = await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET });
    const b = await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET });
    if (!a.ok || !b.ok) throw new Error('prepare failed');

    await updateTweet(deps, { actorId: ACTOR, draftId: a.value.draftId, input: { content: 'A', keepImageIds: [], uploadIds: [] } });
    const later = await updateTweet(deps, { actorId: ACTOR, draftId: b.value.draftId, input: { content: 'B', keepImageIds: [], uploadIds: [] } });

    expect(later).toEqual({ ok: false, code: 'CONFLICT' });
    expect(store.tweets.get(TWEET)?.content).toBe('A');
  });

  it('他人の投稿は編集を始められず、並べ替えた保持画像は拒否する', async () => {
    const { deps } = await published('元', 2);
    expect(await beginTweetEdit(deps, { actorId: OTHER, tweetId: TWEET })).toEqual({ ok: false, code: 'FORBIDDEN' });

    const begun = await beginTweetEdit(deps, { actorId: ACTOR, tweetId: TWEET });
    if (!begun.ok) throw new Error(begun.code);
    const [first, second] = begun.value.images;
    expect(
      await updateTweet(deps, {
        actorId: ACTOR,
        draftId: begun.value.draftId,
        input: { content: '元', keepImageIds: [second.id, first.id], uploadIds: [] },
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT', fieldErrors: { images: ['添付画像を確認してください'] } });
  });
});
