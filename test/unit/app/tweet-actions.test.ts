import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { FakeImageInspector, FakeMediaStorage } from '@/test/support/fake-media-storage';
import { InMemoryTweetStore } from '@/test/support/in-memory-tweet-writer';
import type { InMemoryUserRepository } from '@/test/support/in-memory-user-repository';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';

const boundary = vi.hoisted(() => ({
  calls: [] as string[],
  cookieSet: vi.fn(),
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
    set: (...args: unknown[]) => {
      boundary.calls.push(`cookie:${String(args[0])}=${String(args[1])}`);
      boundary.cookieSet(...args);
    },
  })),
}));
vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/app/_composition/account', () => ({ getAccountDependencies: () => boundary.accountDeps }));
vi.mock('@/app/_composition/tweet', () => ({ getTweetDependencies: () => boundary.tweetDeps }));

const { beginTweetDraftAction, createTweetAction } = await import('@/app/tweets/actions');
const { initialCreateTweetState } = await import('@/app/tweets/form-state');
const { TWEET_FLASH_COOKIE, FLASH_COOKIE, PROFILE_UPDATED_COOKIE, ACCOUNT_DELETED_COOKIE } = await import(
  '@/app/ui/notifications/flash'
);

let store: InMemoryTweetStore;
let users: InMemoryUserRepository;
const NOW = new Date('2026-10-26T03:00:00.000Z');

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

async function openDraft() {
  const result = await beginTweetDraftAction();
  if (!result.ok) throw new Error(result.message);
  boundary.calls.length = 0;
  return result.draftId;
}

beforeEach(async () => {
  boundary.calls.length = 0;
  boundary.cookieSet.mockReset();
  const accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput); // FIXED_ID
  await createAccount(accounts.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  users = accounts.users;
  boundary.accountDeps = accounts.deps;
  store = new InMemoryTweetStore();
  let n = 0;
  boundary.tweetDeps = {
    tweets: store,
    media: store,
    storage: new FakeMediaStorage(),
    inspector: new FakeImageInspector(),
    newId: () => `00000000-0000-4000-8000-${String(500 + n++).padStart(12, '0')}`,
    now: () => NOW,
  };
  signIn(FIXED_ID);
});

describe('beginTweetDraftAction', () => {
  it('ログイン中なら、その利用者を所有者とする下書きを返す', async () => {
    const result = await beginTweetDraftAction();

    expect(result).toEqual({ ok: true, draftId: expect.any(String) });
    if (result.ok) expect(store.drafts.get(result.draftId)?.ownerId).toBe(FIXED_ID);
  });

  it('未ログイン（セッションだけ残った利用者を含む）なら専用の通知を設定してログインへ移動する', async () => {
    for (const id of [null, '00000000-0000-4000-8000-00000000dead']) {
      boundary.calls.length = 0;
      signIn(id);

      await expect(beginTweetDraftAction()).rejects.toThrow('NEXT_REDIRECT');

      expect(boundary.calls).toEqual([`cookie:${TWEET_FLASH_COOKIE}=login-required`, 'redirect:/login']);
    }
    expect(store.drafts.size).toBe(0);
  });

  it('利用者の確認に失敗したら下書きを作らず、失敗を返す', async () => {
    vi.spyOn(users, 'findById').mockRejectedValue(new Error('db down'));

    expect(await beginTweetDraftAction()).toEqual({
      ok: false,
      message: 'ツイートの準備ができませんでした。時間をおいて再度お試しください',
    });
    expect(store.drafts.size).toBe(0);
  });
});

describe('createTweetAction', () => {
  it('成功時はキャッシュ無効化→投稿通知Cookie→/ へのredirectの順に行う', async () => {
    const draftId = await openDraft();

    await expect(
      createTweetAction(initialCreateTweetState, form({ draftId, content: 'こんにちは' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(store.tweets.get(draftId)).toMatchObject({ ownerId: FIXED_ID, content: 'こんにちは', createdAt: NOW });
    expect(boundary.calls).toEqual([
      'revalidate:/',
      'revalidate:/profile/[displayId]:page',
      `cookie:${TWEET_FLASH_COOKIE}=posted`,
      'redirect:/',
    ]);
    expect([FLASH_COOKIE, PROFILE_UPDATED_COOKIE, ACCOUNT_DELETED_COOKIE]).not.toContain(TWEET_FLASH_COOKIE);
  });

  it('所有者・日時・URL・サイズ・verifiedなどの改変した入力は採用しない', async () => {
    const draftId = await openDraft();
    const data = form({ draftId, content: '改変', ownerId: OTHER_ID, createdAt: '2000-01-01', url: 'https://evil', verified: 'true' });

    await expect(createTweetAction(initialCreateTweetState, data)).rejects.toThrow('NEXT_REDIRECT');

    expect(store.tweets.get(draftId)).toMatchObject({ ownerId: FIXED_ID, createdAt: NOW });
  });

  it('呼ぶたびに利用者を確認し、別アカウントに切り替わった下書きからは投稿しない', async () => {
    const draftId = await openDraft();
    signIn(OTHER_ID);

    const state = await createTweetAction(initialCreateTweetState, form({ draftId, content: 'Aの下書き' }));

    expect(state).toMatchObject({ status: 'error', code: 'FORBIDDEN', message: expect.any(String) });
    expect(store.tweets.size).toBe(0);
    expect(boundary.calls).toEqual([]);
  });

  it('未ログインなら投稿せず、ログインへ移動する', async () => {
    const draftId = await openDraft();
    signIn(null);

    await expect(createTweetAction(initialCreateTweetState, form({ draftId, content: 'a' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    expect(boundary.calls).toEqual([`cookie:${TWEET_FLASH_COOKIE}=login-required`, 'redirect:/login']);
    expect(store.tweets.size).toBe(0);
  });

  it('入力違反は欄エラーにし、失敗のたびにattemptを増やす（本文は返さない）', async () => {
    const draftId = await openDraft();

    const first = await createTweetAction(initialCreateTweetState, form({ draftId, content: 'あ'.repeat(281) }));
    const second = await createTweetAction(first, form({ draftId, content: '' }));

    expect(first).toMatchObject({ code: 'INVALID_INPUT', fieldErrors: { content: [expect.any(String)] }, attempt: 1 });
    expect(second).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { content: ['本文か画像のどちらかを入力してください'] },
      attempt: 2,
    });
    expect(JSON.stringify(first)).not.toContain('あああ');
    expect(store.tweets.size).toBe(0);
  });

  it('画像の準備ができていなければ画像欄のエラーにする', async () => {
    const draftId = await openDraft();

    const state = await createTweetAction(
      initialCreateTweetState,
      form({ draftId, content: '', uploadIds: ['00000000-0000-4000-8000-000000000999'] }),
    );

    expect(state).toMatchObject({ code: 'UPLOAD_NOT_READY', fieldErrors: { images: [expect.any(String)] } });
  });

  it('保存の障害は一般的なメッセージにし、遷移しない', async () => {
    const draftId = await openDraft();
    vi.spyOn(store, 'publish').mockRejectedValue(new Error('db down'));

    const state = await createTweetAction(initialCreateTweetState, form({ draftId, content: 'a' }));

    expect(state).toMatchObject({
      code: 'UNAVAILABLE',
      message: 'ツイートできませんでした。時間をおいて再度お試しください',
    });
    expect(boundary.calls).toEqual([]);
  });

  it.each([
    ['下書きIDの欠落', form({ content: 'a' })],
    ['本文のFile', form({ draftId: 'x', content: new Blob(['a']) })],
    ['重複した本文', form({ draftId: 'x', content: ['a', 'b'] })],
    ['Fileの画像ID', form({ draftId: 'x', content: 'a', uploadIds: new Blob(['x']) })],
  ])('不正な形式の送信（%s）は保存しない', async (_label, data) => {
    const state = await createTweetAction(initialCreateTweetState, data);

    expect(state).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(store.tweets.size).toBe(0);
  });
});
