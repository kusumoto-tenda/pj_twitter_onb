import { describe, expect, it, vi } from 'vitest';
import { getProfileLikes } from '@/application/profile/get-profile-likes';
import { setLike } from '@/application/likes/set-like';
import { InMemoryLikeStore } from '@/test/support/in-memory-like-store';
import { InMemoryProfileQuery } from '@/test/support/in-memory-profile-query';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';
const TWEET = '00000000-0000-4000-8000-0000000000d1';
const NOW = new Date('2026-10-27T03:00:00.000Z');

function setup() {
  const store = new InMemoryLikeStore();
  store.addUser(ALICE);
  store.addUser(BOB);
  store.addTweet(TWEET, BOB);
  let n = 0;
  const deps = {
    likes: store,
    newId: () => `00000000-0000-4000-8000-${String(800 + n++).padStart(12, '0')}`,
    now: () => NOW,
  };
  return { store, deps };
}

describe('setLike', () => {
  it('明示されたactiveのとおりに登録・解除し、公開件数を返す。同じ登録の再送は1行のまま', async () => {
    const { store, deps } = setup();

    expect(await setLike(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true })).toEqual({
      ok: true,
      active: true,
      count: 1,
    });
    const [first] = store.forTweet(TWEET);
    expect(await setLike(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true })).toEqual({
      ok: true,
      active: true,
      count: 1,
    });
    // 登録済みへの再送はUUID・日時を変えない
    expect(store.forTweet(TWEET)).toEqual([first]);

    // 別の利用者のいいねは件数に加わる（自分の投稿へのいいねも許可）
    expect(await setLike(deps, { actorId: BOB, expectedActorId: BOB, tweetId: TWEET, active: true })).toEqual({
      ok: true,
      active: true,
      count: 2,
    });

    expect(await setLike(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: false })).toEqual({
      ok: true,
      active: false,
      count: 1,
    });
    // 解除済みの解除も成功し、他人のいいねは残る
    expect(await setLike(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: false })).toEqual({
      ok: true,
      active: false,
      count: 1,
    });
    expect(store.forTweet(TWEET).map((like) => like.executorId)).toEqual([BOB]);
  });

  it('UUIDは小文字に揃え、明示されたactiveと新しいUUID・日時を保存側へ渡す', async () => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    await setLike(deps, { actorId: ALICE, expectedActorId: ALICE.toUpperCase(), tweetId: TWEET.toUpperCase(), active: false });

    expect(set).toHaveBeenCalledWith({ actorId: ALICE, tweetId: TWEET, active: false, id: expect.any(String), now: NOW });
  });

  it('未ログインなら保存側を呼ばない', async () => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    expect(await setLike(deps, { actorId: null, expectedActorId: null, tweetId: TWEET, active: true })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    ['画面を表示した利用者と違う', { actorId: BOB, expectedActorId: ALICE }],
    ['未ログインで表示した画面から送った', { actorId: ALICE, expectedActorId: null }],
  ])('%s場合はSESSION_CHANGEDで、どちらのいいねも変えない', async (_label, actors) => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    expect(await setLike(deps, { ...actors, tweetId: TWEET, active: true })).toEqual({ ok: false, code: 'SESSION_CHANGED' });
    expect(set).not.toHaveBeenCalled();
    expect(store.forTweet(TWEET)).toEqual([]);
  });

  it.each([
    ['投稿ID', { expectedActorId: ALICE, tweetId: 'nope' }],
    ['画面の利用者', { expectedActorId: 'nope', tweetId: TWEET }],
    ['前後に空白のある投稿ID', { expectedActorId: ALICE, tweetId: ` ${TWEET}` }],
  ])('%sがUUIDでなければINVALID_REQUESTで、保存側を呼ばない', async (_label, input) => {
    const { store, deps } = setup();
    const set = vi.spyOn(store, 'set');

    expect(await setLike(deps, { actorId: ALICE, ...input, active: true })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(set).not.toHaveBeenCalled();
  });

  it('対象の投稿がなければNOT_FOUND、利用者が既にいなければUNAUTHENTICATED', async () => {
    const { store, deps } = setup();
    expect(
      await setLike(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: '00000000-0000-4000-8000-0000000000ff', active: true }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    store.removeUser(ALICE);
    expect(await setLike(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });

  it('DBの障害はUNAVAILABLE（成功扱いにしない）', async () => {
    const { store, deps } = setup();
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('db down'));

    expect(await setLike(deps, { actorId: ALICE, expectedActorId: ALICE, tweetId: TWEET, active: true })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

describe('getProfileLikes', () => {
  const after = { createdAt: '2026-10-27T03:00:00.123456Z', likeId: '00000000-0000-4000-8000-0000000000e1' };

  it('未ログインでも対象者の公開いいね一覧を20件ずつ取得できる', async () => {
    const query = new InMemoryProfileQuery();
    query.likedPage = { items: [], nextCursor: after };

    expect(await getProfileLikes({ query }, { subjectId: ALICE, viewerId: null, after: null })).toEqual({
      ok: true,
      page: { items: [], nextCursor: after },
    });
    expect(query.requests.liked).toEqual([{ subjectId: ALICE, viewerId: null, after: null, limit: 20 }]);
  });

  it('対象者（subject）と閲覧者（viewer）を取り違えずにQueryへ渡す', async () => {
    const query = new InMemoryProfileQuery();

    await getProfileLikes({ query }, { subjectId: ALICE, viewerId: BOB, after });

    expect(query.requests.liked).toEqual([{ subjectId: ALICE, viewerId: BOB, after, limit: 20 }]);
  });

  it('取得障害は0件にせず UNAVAILABLE を返す', async () => {
    const findLikedPage = vi.fn().mockRejectedValue(new Error('db down'));

    expect(await getProfileLikes({ query: { findLikedPage } }, { subjectId: ALICE, viewerId: null, after: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
