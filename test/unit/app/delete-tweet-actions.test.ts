import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { FakeImageInspector, FakeMediaStorage } from '@/test/support/fake-media-storage';
import { InMemoryTweetDeleter } from '@/test/support/in-memory-tweet-deleter';
import { InMemoryTweetStore } from '@/test/support/in-memory-tweet-writer';
import type { InMemoryUserRepository } from '@/test/support/in-memory-user-repository';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const TWEET = '00000000-0000-4000-8000-0000000000d1';
const NOW = new Date('2026-10-26T03:00:00.000Z');

const boundary = vi.hoisted(() => ({
  calls: [] as string[],
  session: null as unknown,
  accountDeps: undefined as unknown,
  tweetDeps: undefined as unknown,
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
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string) => boundary.calls.push(`cookie:${name}=${value}`),
  })),
}));
vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/app/_composition/account', () => ({ getAccountDependencies: () => boundary.accountDeps }));
vi.mock('@/app/_composition/tweet', () => ({ getTweetDependencies: () => boundary.tweetDeps }));

const { beginTweetDeleteAction, deleteTweetAction } = await import('@/app/tweets/delete-actions');
const { initialDeleteTweetState } = await import('@/app/tweets/delete-form-state');
const { TWEET_FLASH_COOKIE } = await import('@/app/ui/notifications/flash');

let store: InMemoryTweetStore;
let deleter: InMemoryTweetDeleter;
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
  store = new InMemoryTweetStore();
  deleter = new InMemoryTweetDeleter(store);
  await store.createDraft({ id: TWEET, ownerId: FIXED_ID, expiresAt: new Date(NOW.getTime() + 3600_000), now: NOW });
  await store.publish({ actorId: FIXED_ID, draftId: TWEET, value: { content: '消す本文', uploadIds: [] }, fingerprint: 'c', now: NOW });
  boundary.tweetDeps = {
    tweets: store,
    media: store,
    deleter,
    storage: new FakeMediaStorage(),
    inspector: new FakeImageInspector(),
    newId: () => '00000000-0000-4000-8000-000000000600',
    now: () => NOW,
  };
  signIn(FIXED_ID);
});

describe('beginTweetDeleteAction', () => {
  it('本人の投稿なら、確認に使う投稿IDと準備時の利用者を返し、何も削除しない', async () => {
    expect(await beginTweetDeleteAction(TWEET)).toEqual({
      ok: true,
      value: { tweetId: TWEET, actorId: FIXED_ID, content: '消す本文' },
    });
    expect(store.tweets.has(TWEET)).toBe(true);
    expect(boundary.calls).toEqual([]);
  });

  it('未ログイン（セッションだけ残った利用者を含む）なら、削除用の通知を設定してログインへ移動する', async () => {
    for (const id of [null, '00000000-0000-4000-8000-00000000dead']) {
      boundary.calls.length = 0;
      signIn(id);
      await expect(beginTweetDeleteAction(TWEET)).rejects.toThrow('NEXT_REDIRECT');
      expect(boundary.calls).toEqual([`cookie:${TWEET_FLASH_COOKIE}=delete-login-required`, 'redirect:/login']);
    }
  });

  it('他人の投稿・改ざんしたIDは開かず理由を返す。既にない投稿は削除済みと知らせて一覧を再取得させる', async () => {
    signIn(OTHER_ID);
    expect(await beginTweetDeleteAction(TWEET)).toEqual({ ok: false, message: 'このツイートは削除できません' });
    signIn(FIXED_ID);
    expect(await beginTweetDeleteAction('nope')).toEqual({ ok: false, message: 'このツイートは見つかりませんでした' });
    expect(boundary.calls).toEqual([]);
    expect(await beginTweetDeleteAction('00000000-0000-4000-8000-0000000000ff')).toEqual({
      ok: false,
      message: 'このツイートは既に削除されています',
    });
    expect(boundary.calls).toEqual(REVALIDATE);
  });

  it('利用者の確認やDBの障害は、再試行の案内にする', async () => {
    users.findById = async () => {
      throw new Error('db down');
    };
    expect(await beginTweetDeleteAction(TWEET)).toEqual({
      ok: false,
      message: 'ツイートを削除できませんでした。時間をおいて再度お試しください',
    });
  });
});

describe('deleteTweetAction', () => {
  const valid = () => form({ tweetId: TWEET, expectedActorId: FIXED_ID });

  it('本人なら削除し、メイン・プロフィールを再取得させる。画面は移動しない', async () => {
    expect(await deleteTweetAction(initialDeleteTweetState, valid())).toEqual({ status: 'success', attempt: 1 });
    expect(store.tweets.has(TWEET)).toBe(false);
    expect(boundary.calls).toEqual(REVALIDATE);
  });

  it('未ログインなら削除せず、削除用の通知を設定してログインへ移動する', async () => {
    signIn(null);
    await expect(deleteTweetAction(initialDeleteTweetState, valid())).rejects.toThrow('NEXT_REDIRECT');
    expect(boundary.calls).toEqual([`cookie:${TWEET_FLASH_COOKIE}=delete-login-required`, 'redirect:/login']);
    expect(store.tweets.has(TWEET)).toBe(true);
  });

  it('開いた後で別の利用者に切り替わっていたら、どちらの投稿も削除しない', async () => {
    signIn(OTHER_ID);
    expect(await deleteTweetAction(initialDeleteTweetState, valid())).toEqual({
      status: 'error',
      code: 'SESSION_CHANGED',
      message: 'ログイン中の利用者が変わりました。画面を開き直してください',
      attempt: 1,
    });
    expect(deleter.deleted).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });

  it('他人が自分のIDを準備時の利用者として送っても、他人の投稿は削除しない', async () => {
    signIn(OTHER_ID);
    const result = await deleteTweetAction(initialDeleteTweetState, form({ tweetId: TWEET, expectedActorId: OTHER_ID }));

    expect(result).toMatchObject({ status: 'error', code: 'FORBIDDEN', message: 'このツイートは削除できません' });
    expect(store.tweets.has(TWEET)).toBe(true);
  });

  it.each([
    ['投稿IDがない', form({ expectedActorId: FIXED_ID })],
    ['投稿IDが複数', form({ tweetId: [TWEET, TWEET], expectedActorId: FIXED_ID })],
    ['投稿IDがファイル', form({ tweetId: new Blob(['x']), expectedActorId: FIXED_ID })],
    ['投稿IDがUUIDでない', form({ tweetId: 'nope', expectedActorId: FIXED_ID })],
    ['準備時の利用者がない', form({ tweetId: TWEET })],
  ])('改ざんされた送信（%s）は削除しない', async (_label, data) => {
    expect(await deleteTweetAction(initialDeleteTweetState, data)).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(deleter.deleted).toEqual([]);
  });

  it('既にない投稿は削除成功と区別して知らせ、一覧を再取得させる', async () => {
    await deleteTweetAction(initialDeleteTweetState, valid());
    boundary.calls.length = 0;

    expect(await deleteTweetAction({ status: 'success', attempt: 1 }, valid())).toEqual({
      status: 'not-found',
      message: 'このツイートは既に削除されています',
      attempt: 2,
    });
    expect(boundary.calls).toEqual(REVALIDATE);
  });

  it('DB・利用者確認の障害は、削除せず再試行の案内にする。再試行すると削除できる', async () => {
    const original = deleter.deleteOwned.bind(deleter);
    deleter.deleteOwned = async () => {
      throw new Error('db down');
    };
    const failed = await deleteTweetAction(initialDeleteTweetState, valid());
    expect(failed).toEqual({
      status: 'error',
      code: 'UNAVAILABLE',
      message: 'ツイートを削除できませんでした。時間をおいて再度お試しください',
      attempt: 1,
    });
    expect(boundary.calls).toEqual([]);

    users.findById = async () => {
      throw new Error('db down');
    };
    expect(await deleteTweetAction(failed, valid())).toMatchObject({ status: 'error', code: 'UNAVAILABLE', attempt: 2 });

    deleter.deleteOwned = original;
    users.findById = (await import('@/test/support/in-memory-user-repository')).InMemoryUserRepository.prototype.findById.bind(users);
    expect(await deleteTweetAction(failed, valid())).toEqual({ status: 'success', attempt: 2 });
  });
});
