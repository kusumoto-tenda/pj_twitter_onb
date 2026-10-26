import { describe, expect, it, vi } from 'vitest';
import { setRetweet } from '@/application/retweets/set-retweet';
import type { RetweetRepository } from '@/application/retweets/ports/retweet-repository';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';
const TWEET = '00000000-0000-4000-8000-0000000000d1';
const RETWEET = '00000000-0000-4000-8000-0000000000e1';
const NOW = new Date('2026-10-27T03:00:00.000Z');
const input = { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true };

function setup() {
  const set = vi.fn<RetweetRepository['set']>().mockImplementation(async ({ active }) => ({ status: 'set', active, count: 3 }));
  const deps = { retweets: { set }, newId: vi.fn(() => RETWEET), now: vi.fn(() => NOW) };
  return { deps, set };
}

function expectNoWrite({ deps, set }: ReturnType<typeof setup>) {
  expect(set).not.toHaveBeenCalled();
  expect(deps.newId).not.toHaveBeenCalled();
  expect(deps.now).not.toHaveBeenCalled();
}

describe('setRetweet', () => {
  it.each([true, false])('active=%sをそのまま元投稿UUIDと保存側へ渡し、操作後の件数を返す', async (active) => {
    const { deps, set } = setup();

    expect(await setRetweet(deps, { ...input, active })).toEqual({ ok: true, active, count: 3 });
    expect(set).toHaveBeenCalledExactlyOnceWith({ actorId: ALICE, tweetId: TWEET, active, id: RETWEET, now: NOW });
  });

  it('actor・画面の利用者・元投稿のUUIDは小文字に正規化して照合し、保存側にも小文字で渡す', async () => {
    const { deps, set } = setup();

    expect(await setRetweet(deps, {
      ...input,
      actorId: ALICE.toUpperCase(),
      expectedActorId: ALICE.toUpperCase(),
      tweetId: TWEET.toUpperCase(),
    })).toEqual({ ok: true, active: true, count: 3 });
    expect(set.mock.calls[0][0]).toMatchObject({ actorId: ALICE, tweetId: TWEET });
  });

  it('サーバー生成のUUIDと時計だけを使い、送信に余分な実行者・UUID・日時があっても採用しない', async () => {
    const { deps, set } = setup();
    const posted = { ...input, executorId: BOB, id: BOB, now: new Date('2000-01-01T00:00:00Z') };

    await setRetweet(deps, posted);

    expect(set).toHaveBeenCalledExactlyOnceWith({ actorId: ALICE, tweetId: TWEET, active: true, id: RETWEET, now: NOW });
    expect(deps.newId).toHaveBeenCalledTimes(1);
    expect(deps.now).toHaveBeenCalledTimes(1);
  });

  it('同じ状態への再送でもactiveを反転せず、保存側の成功結果を返す', async () => {
    const { deps, set } = setup();

    expect(await setRetweet(deps, input)).toEqual({ ok: true, active: true, count: 3 });
    expect(await setRetweet(deps, input)).toEqual({ ok: true, active: true, count: 3 });
    expect(set.mock.calls.map(([value]) => [value.actorId, value.tweetId, value.active])).toEqual([
      [ALICE, TWEET, true],
      [ALICE, TWEET, true],
    ]);
  });

  it('自己投稿のリツイートも許可する', async () => {
    const { deps, set } = setup();
    const ownTweet = { id: TWEET, ownerId: ALICE };

    expect(await setRetweet(deps, { ...input, actorId: ownTweet.ownerId, tweetId: ownTweet.id })).toEqual({
      ok: true,
      active: true,
      count: 3,
    });
    expect(set).toHaveBeenCalledExactlyOnceWith({ actorId: ALICE, tweetId: TWEET, active: true, id: RETWEET, now: NOW });
  });

  it('状態・件数は推測せず保存側の確定値を使う', async () => {
    const { deps, set } = setup();
    set.mockResolvedValue({ status: 'set', active: false, count: 2 });

    expect(await setRetweet(deps, input)).toEqual({ ok: true, active: false, count: 2 });
  });

  it('未認証ならUNAUTHENTICATEDで保存側・UUID生成・時計を使わない', async () => {
    const ctx = setup();

    expect(await setRetweet(ctx.deps, { ...input, actorId: null })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expectNoWrite(ctx);
  });

  it.each([
    ['画面表示時と違う利用者', { actorId: BOB, expectedActorId: ALICE }],
    ['未ログインで表示した画面', { actorId: ALICE, expectedActorId: null }],
  ])('%sならSESSION_CHANGEDで、どちらの行も変更しない', async (_name, actors) => {
    const ctx = setup();

    expect(await setRetweet(ctx.deps, { ...input, ...actors })).toEqual({ ok: false, code: 'SESSION_CHANGED' });
    expectNoWrite(ctx);
  });

  it.each([
    ['actor', { actorId: 'nope' }],
    ['画面の利用者', { expectedActorId: 'nope' }],
    ['元投稿', { tweetId: 'nope' }],
    ['空のUUID', { tweetId: '' }],
    ['前後空白', { tweetId: ` ${TWEET} ` }],
  ])('%sが厳密なUUIDでなければINVALID_REQUESTで保存しない', async (_name, invalid) => {
    const ctx = setup();

    expect(await setRetweet(ctx.deps, { ...input, ...invalid })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expectNoWrite(ctx);
  });

  it.each([
    ['actor-not-found', 'UNAUTHENTICATED'],
    ['tweet-not-found', 'NOT_FOUND'],
  ] as const)('保存側の%sを%sへ変換する', async (status, code) => {
    const { deps, set } = setup();
    set.mockResolvedValue({ status });

    expect(await setRetweet(deps, input)).toEqual({ ok: false, code });
  });

  it('保存側の例外を内容を漏らさずUNAVAILABLEへ変換する', async () => {
    const { deps, set } = setup();
    set.mockRejectedValue(new Error('database connection failed'));

    await expect(setRetweet(deps, input)).resolves.toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(set).toHaveBeenCalledTimes(1);
  });
});
