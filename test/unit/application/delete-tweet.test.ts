import { describe, expect, it, vi } from 'vitest';
import type { DeleteTarget } from '@/application/tweets/ports/tweet-deleter';
import { beginTweetDelete } from '@/application/tweets/begin-tweet-delete';
import { deleteTweet } from '@/application/tweets/delete-tweet';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';
const TWEET = '00000000-0000-4000-8000-0000000000d1';

function deleter(
  target: DeleteTarget | null = { tweetId: TWEET, ownerId: ALICE, content: '消す本文' },
  outcome: 'deleted' | 'not-found' | 'forbidden' = 'deleted',
) {
  return {
    findTarget: vi.fn(async (_tweetId: string) => target),
    deleteOwned: vi.fn(async (_input: { actorId: string; tweetId: string }) => outcome),
  };
}

describe('beginTweetDelete', () => {
  it('本人の投稿なら、確認に使う投稿IDと準備時の利用者を返す。削除はしない', async () => {
    const deps = { deleter: deleter() };

    expect(await beginTweetDelete(deps, { actorId: ALICE, tweetId: TWEET.toUpperCase() })).toEqual({
      ok: true,
      value: { tweetId: TWEET, actorId: ALICE, content: '消す本文' },
    });
    expect(deps.deleter.findTarget).toHaveBeenCalledWith(TWEET);
    expect(deps.deleter.deleteOwned).not.toHaveBeenCalled();
  });

  it('未ログイン・UUIDでない投稿IDではDBを使わない', async () => {
    const deps = { deleter: deleter() };

    expect(await beginTweetDelete(deps, { actorId: null, tweetId: TWEET })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await beginTweetDelete(deps, { actorId: ALICE, tweetId: 'nope' })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(deps.deleter.findTarget).not.toHaveBeenCalled();
  });

  it('存在しない投稿はNOT_FOUND、他人の投稿はFORBIDDEN', async () => {
    expect(await beginTweetDelete({ deleter: deleter(null) }, { actorId: ALICE, tweetId: TWEET })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await beginTweetDelete({ deleter: deleter() }, { actorId: BOB, tweetId: TWEET })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });

  it('DBの障害はUNAVAILABLE', async () => {
    const deps = { deleter: deleter() };
    deps.deleter.findTarget.mockRejectedValueOnce(new Error('db down'));

    expect(await beginTweetDelete(deps, { actorId: ALICE, tweetId: TWEET })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('deleteTweet', () => {
  it('準備時と同じ本人なら、小文字に揃えた投稿IDで削除する', async () => {
    const deps = { deleter: deleter() };

    expect(await deleteTweet(deps, { actorId: ALICE, expectedActorId: ALICE.toUpperCase(), tweetId: TWEET.toUpperCase() })).toEqual({
      ok: true,
    });
    expect(deps.deleter.deleteOwned).toHaveBeenCalledWith({ actorId: ALICE, tweetId: TWEET });
  });

  it('未ログインなら削除しない', async () => {
    const deps = { deleter: deleter() };

    expect(await deleteTweet(deps, { actorId: null, expectedActorId: ALICE, tweetId: TWEET })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(deps.deleter.deleteOwned).not.toHaveBeenCalled();
  });

  it.each([
    ['投稿ID', { expectedActorId: ALICE, tweetId: 'nope' }],
    ['準備時の利用者', { expectedActorId: '', tweetId: TWEET }],
  ])('%sがUUIDでなければINVALID_REQUEST', async (_label, input) => {
    const deps = { deleter: deleter() };

    expect(await deleteTweet(deps, { actorId: ALICE, ...input })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(deps.deleter.deleteOwned).not.toHaveBeenCalled();
  });

  it('準備後に別の利用者へ切り替わっていたら、どちらの投稿も削除しない', async () => {
    const deps = { deleter: deleter() };

    expect(await deleteTweet(deps, { actorId: BOB, expectedActorId: ALICE, tweetId: TWEET })).toEqual({
      ok: false,
      code: 'SESSION_CHANGED',
    });
    expect(deps.deleter.deleteOwned).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', 'NOT_FOUND'],
    ['forbidden', 'FORBIDDEN'],
  ] as const)('保存側の %s は %s にする', async (outcome, code) => {
    const deps = { deleter: deleter(undefined, outcome) };

    expect(await deleteTweet(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET })).toEqual({ ok: false, code });
  });

  it('DBの障害はUNAVAILABLE（再試行できる）', async () => {
    const deps = { deleter: deleter() };
    deps.deleter.deleteOwned.mockRejectedValueOnce(new Error('db down'));

    expect(await deleteTweet(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
