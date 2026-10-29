import { describe, expect, it, vi } from 'vitest';
import { getFavorites } from '@/application/usecases/favorites/get-favorites';
import { setFavorite } from '@/application/usecases/favorites/set-favorite';
import { InMemoryFavoriteStore } from '@/test/support/in-memory-favorite-store';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';
const TWEET = '00000000-0000-4000-8000-0000000000d1';
const NOW = new Date('2026-10-26T03:00:00.000Z');

function setup() {
  const store = new InMemoryFavoriteStore();
  store.addUser(ALICE);
  store.addUser(BOB);
  store.addTweet(TWEET, BOB);
  let n = 0;
  const deps = {
    favorites: store,
    newId: () => `00000000-0000-4000-8000-${String(700 + n++).padStart(12, '0')}`,
    now: () => NOW,
  };
  return { store, deps };
}

describe('setFavorite', () => {
  it('明示されたactiveのとおりに登録・解除し、同じ登録を2回送っても1行にする', async () => {
    const { store, deps } = setup();

    expect(await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true })).toEqual({
      ok: true,
      active: true,
    });
    await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true });
    expect(store.forUser(ALICE)).toHaveLength(1);

    expect(await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: false })).toEqual({
      ok: true,
      active: false,
    });
    // 解除済みの解除も成功
    expect(await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: false })).toEqual({
      ok: true,
      active: false,
    });
    expect(store.forUser(ALICE)).toHaveLength(0);
  });

  it('UUIDは小文字に揃え、明示されたactiveをそのまま保存側へ渡す', async () => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE.toUpperCase(), tweetId: TWEET.toUpperCase(), active: false });

    expect(set).toHaveBeenCalledWith({ actorId: ALICE, tweetId: TWEET, active: false, id: expect.any(String), now: NOW });
  });

  it('未ログインなら保存側を呼ばない', async () => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    expect(await setFavorite(deps, { actorId: null, expectedActorId: null, tweetId: TWEET, active: true })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    ['画面を表示した利用者と違う', { actorId: BOB, expectedActorId: ALICE }],
    ['未ログインで表示した画面から送った', { actorId: ALICE, expectedActorId: null }],
  ])('%s場合はSESSION_CHANGEDで、保存側を呼ばない', async (_label, actors) => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    expect(await setFavorite(deps, { ...actors, tweetId: TWEET, active: true })).toEqual({ ok: false, code: 'SESSION_CHANGED' });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    ['投稿ID', { expectedActorId: ALICE, tweetId: 'nope' }],
    ['画面の利用者', { expectedActorId: 'nope', tweetId: TWEET }],
  ])('%sがUUIDでなければINVALID_REQUESTで、保存側を呼ばない', async (_label, input) => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    expect(await setFavorite(deps, { actorId: ALICE, ...input, active: true })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(set).not.toHaveBeenCalled();
  });

  it('対象の投稿がなければNOT_FOUND、利用者が既にいなければUNAUTHENTICATED', async () => {
    const { store, deps } = setup();
    expect(
      await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: '00000000-0000-4000-8000-0000000000ff', active: true }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    store.removeUser(ALICE);
    expect(await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });

  it('DBの障害はUNAVAILABLE', async () => {
    const { store, deps } = setup();
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('db down'));

    expect(await setFavorite(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

describe('getFavorites', () => {
  it('ログイン中の本人の保存だけを20件ずつ取得する', async () => {
    const { store } = setup();
    const findPage = vi.spyOn(store, 'findPage');
    const after = { createdAt: '2026-10-26T03:00:00.000000Z', favoriteId: TWEET };

    expect(await getFavorites({ query: store }, { actorId: ALICE, after })).toEqual({
      ok: true,
      page: { items: [], nextCursor: null },
    });
    expect(findPage).toHaveBeenCalledWith({ actorId: ALICE, after, limit: 20 });
  });

  it('未ログインなら取得しない。DBの障害はUNAVAILABLE（0件と区別する）', async () => {
    const { store } = setup();
    const findPage = vi.spyOn(store, 'findPage');

    expect(await getFavorites({ query: store }, { actorId: null, after: null })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(findPage).not.toHaveBeenCalled();
    findPage.mockRejectedValueOnce(new Error('db down'));
    expect(await getFavorites({ query: store }, { actorId: ALICE, after: null })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
