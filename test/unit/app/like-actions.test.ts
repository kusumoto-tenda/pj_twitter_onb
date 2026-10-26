import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { InMemoryLikeStore } from '@/test/support/in-memory-like-store';
import type { InMemoryUserRepository } from '@/test/support/in-memory-user-repository';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const TWEET = '00000000-0000-4000-8000-0000000000d1';
const NOW = new Date('2026-10-27T03:00:00.000Z');

const boundary = vi.hoisted(() => ({
  calls: [] as string[],
  session: null as unknown,
  accountDeps: undefined as unknown,
  likeDeps: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    boundary.calls.push(`redirect:${url}`);
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string, type?: string) => {
    boundary.calls.push(`revalidate:${path}${type ? `:${type}` : ''}`);
  }),
}));
vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/app/_composition/account', () => ({ getAccountDependencies: () => boundary.accountDeps }));
vi.mock('@/app/_composition/likes', () => ({ getLikeDependencies: () => boundary.likeDeps }));

const { setLikeAction } = await import('@/app/likes/actions');

let store: InMemoryLikeStore;
let users: InMemoryUserRepository;

function signIn(id: string | null) {
  boundary.session = id ? { user: { id }, expires: '2099-01-01T00:00:00Z' } : null;
}

function form(fields: Record<string, string | string[] | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const REVALIDATE = ['revalidate:/', 'revalidate:/profile/[displayId]:page', 'revalidate:/favorites'];

beforeEach(async () => {
  boundary.calls.length = 0;
  const accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput); // FIXED_ID
  await createAccount(accounts.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  users = accounts.users;
  boundary.accountDeps = accounts.deps;
  store = new InMemoryLikeStore();
  store.addUser(FIXED_ID);
  store.addUser(OTHER_ID);
  store.addTweet(TWEET, OTHER_ID);
  boundary.likeDeps = {
    likes: store,
    newId: () => '00000000-0000-4000-8000-000000000800',
    now: () => NOW,
  };
  signIn(FIXED_ID);
});

describe('setLikeAction', () => {
  it('trueで登録・falseで解除して状態と公開件数を返し、成功時だけメイン・プロフィール・お気に入りを再取得させる', async () => {
    expect(await setLikeAction(form({ tweetId: TWEET, active: 'true', expectedActorId: FIXED_ID }))).toEqual({
      ok: true,
      active: true,
      count: 1,
    });
    expect(store.forTweet(TWEET)).toHaveLength(1);
    expect(boundary.calls).toEqual(REVALIDATE);

    boundary.calls.length = 0;
    expect(await setLikeAction(form({ tweetId: TWEET, active: 'false', expectedActorId: FIXED_ID }))).toEqual({
      ok: true,
      active: false,
      count: 0,
    });
    expect(store.forTweet(TWEET)).toHaveLength(0);
    expect(boundary.calls).toEqual(REVALIDATE);
  });

  it('いいねする利用者は送信内容ではなくセッションで決める（他人の名義へ差し替えられない）', async () => {
    const data = form({ tweetId: TWEET, active: 'true', expectedActorId: FIXED_ID, actorId: OTHER_ID });

    await setLikeAction(data);

    expect(store.forTweet(TWEET).map((like) => like.executorId)).toEqual([FIXED_ID]);
  });

  it.each([
    ['activeがない', form({ tweetId: TWEET, expectedActorId: FIXED_ID })],
    ['activeが真偽値の文字列でない', form({ tweetId: TWEET, active: 'yes', expectedActorId: FIXED_ID })],
    ['activeが大文字', form({ tweetId: TWEET, active: 'TRUE', expectedActorId: FIXED_ID })],
    ['activeが1', form({ tweetId: TWEET, active: '1', expectedActorId: FIXED_ID })],
    ['activeが複数', form({ tweetId: TWEET, active: ['true', 'false'], expectedActorId: FIXED_ID })],
    ['activeがファイル', form({ tweetId: TWEET, active: new Blob(['true']), expectedActorId: FIXED_ID })],
    ['投稿IDがない', form({ active: 'true', expectedActorId: FIXED_ID })],
    ['投稿IDが複数', form({ tweetId: [TWEET, TWEET], active: 'true', expectedActorId: FIXED_ID })],
    ['投稿IDがファイル', form({ tweetId: new Blob([TWEET]), active: 'true', expectedActorId: FIXED_ID })],
    ['投稿IDがUUIDでない', form({ tweetId: 'nope', active: 'true', expectedActorId: FIXED_ID })],
    ['画面の利用者が複数', form({ tweetId: TWEET, active: 'true', expectedActorId: [FIXED_ID, FIXED_ID] })],
    ['画面の利用者がファイル', form({ tweetId: TWEET, active: 'true', expectedActorId: new Blob([FIXED_ID]) })],
  ])('改ざんされた送信（%s）は変更しない', async (_label, data) => {
    expect(await setLikeAction(data)).toEqual({
      ok: false,
      message: 'いいねを変更できませんでした。画面を開き直してください',
    });
    expect(store.likes).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });

  it('未ログイン（セッションだけ残った利用者を含む）ならログイン画面へ移動せず、案内だけを返す', async () => {
    for (const id of [null, '00000000-0000-4000-8000-00000000dead']) {
      signIn(id);
      expect(await setLikeAction(form({ tweetId: TWEET, active: 'true' }))).toEqual({
        ok: false,
        message: 'ログイン中のみいいねできます',
      });
    }
    expect(store.likes).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });

  it.each([
    ['別の利用者で表示した画面', OTHER_ID],
    ['未ログインで表示した画面', undefined],
  ])('%sから送られたら、誰のいいねも変えない', async (_label, expected) => {
    store.likes.push({ id: '00000000-0000-4000-8000-000000000801', executorId: OTHER_ID, tweetId: TWEET, createdAt: NOW });
    const fields: Record<string, string> = { tweetId: TWEET, active: 'false' };
    if (expected) fields.expectedActorId = expected;

    expect(await setLikeAction(form(fields))).toEqual({
      ok: false,
      message: 'ログイン中の利用者が変わりました。画面を開き直してください',
    });
    expect(store.forTweet(TWEET).map((like) => like.executorId)).toEqual([OTHER_ID]);
    expect(boundary.calls).toEqual([]);
  });

  it('対象の投稿がなければ理由を返し、一覧を再取得させる', async () => {
    expect(
      await setLikeAction(form({ tweetId: '00000000-0000-4000-8000-0000000000ff', active: 'true', expectedActorId: FIXED_ID })),
    ).toEqual({ ok: false, message: 'このツイートは見つかりませんでした' });
    expect(boundary.calls).toEqual(REVALIDATE);
  });

  it('DB・利用者確認の障害は再試行の案内にし、再取得させない', async () => {
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('db down'));
    const retry = { ok: false, message: 'いいねを変更できませんでした。時間をおいて再度お試しください' };
    expect(await setLikeAction(form({ tweetId: TWEET, active: 'true', expectedActorId: FIXED_ID }))).toEqual(retry);

    users.findById = async () => {
      throw new Error('db down');
    };
    expect(await setLikeAction(form({ tweetId: TWEET, active: 'true', expectedActorId: FIXED_ID }))).toEqual(retry);
    expect(store.likes).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });
});
