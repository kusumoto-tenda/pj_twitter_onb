import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/usecases/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { FakeImageInspector, FakeMediaStorage } from '@/test/support/fake-media-storage';
import { InMemoryTweetEditor } from '@/test/support/in-memory-tweet-editor';
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
vi.mock('@/main/container/account', () => ({ getAccountDependencies: () => boundary.accountDeps }));
vi.mock('@/main/container/tweet', () => ({ getTweetDependencies: () => boundary.tweetDeps }));

const { beginTweetEditAction, updateTweetAction } = await import('@/app/tweets/edit-actions');
const { initialEditTweetState } = await import('@/app/tweets/edit-form-state');
const { TWEET_FLASH_COOKIE } = await import('@/app/ui/notifications/flash');

let store: InMemoryTweetStore;
let editor: InMemoryTweetEditor;
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

async function openEdit() {
  const result = await beginTweetEditAction(TWEET);
  if (!result.ok) throw new Error(result.message);
  boundary.calls.length = 0;
  return result.value;
}

beforeEach(async () => {
  boundary.calls.length = 0;
  const accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput); // FIXED_ID
  await createAccount(accounts.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  users = accounts.users;
  boundary.accountDeps = accounts.deps;
  store = new InMemoryTweetStore();
  editor = new InMemoryTweetEditor(store);
  await store.createDraft({ id: TWEET, ownerId: FIXED_ID, expiresAt: new Date(NOW.getTime() + 3600_000), now: NOW });
  await store.publish({ actorId: FIXED_ID, draftId: TWEET, value: { content: '元の本文', uploadIds: [] }, fingerprint: 'c', now: NOW });
  let n = 0;
  boundary.tweetDeps = {
    tweets: store,
    media: store,
    editor,
    storage: new FakeMediaStorage(),
    inspector: new FakeImageInspector(),
    newId: () => `00000000-0000-4000-8000-${String(600 + n++).padStart(12, '0')}`,
    now: () => NOW,
  };
  signIn(FIXED_ID);
});

describe('beginTweetEditAction', () => {
  it('本人ならDBの現在の内容で編集用の下書きを返す', async () => {
    const result = await beginTweetEditAction(TWEET);

    expect(result).toEqual({
      ok: true,
      value: { draftId: expect.any(String), tweetId: TWEET, content: '元の本文', images: [] },
    });
  });

  it('未ログイン（セッションだけ残った利用者を含む）なら、編集用の通知を設定してログインへ移動する', async () => {
    for (const id of [null, '00000000-0000-4000-8000-00000000dead']) {
      boundary.calls.length = 0;
      signIn(id);
      await expect(beginTweetEditAction(TWEET)).rejects.toThrow('NEXT_REDIRECT');
      expect(boundary.calls).toEqual([`cookie:${TWEET_FLASH_COOKIE}=edit-login-required`, 'redirect:/login']);
    }
  });

  it('他人の投稿・存在しない投稿は開かず、理由を返す', async () => {
    signIn(OTHER_ID);
    expect(await beginTweetEditAction(TWEET)).toEqual({ ok: false, message: 'このツイートは編集できません' });
    signIn(FIXED_ID);
    expect(await beginTweetEditAction('00000000-0000-4000-8000-0000000000ff')).toEqual({
      ok: false,
      message: 'このツイートは見つかりませんでした',
    });
  });

  it('利用者の確認やDBの障害は、再試行の案内にする', async () => {
    vi.spyOn(users, 'findById').mockRejectedValueOnce(new Error('db down'));
    expect(await beginTweetEditAction(TWEET)).toEqual({
      ok: false,
      message: 'ツイートを編集できませんでした。時間をおいて再度お試しください',
    });
    vi.spyOn(editor, 'prepare').mockRejectedValueOnce(new Error('db down'));
    expect(await beginTweetEditAction(TWEET)).toEqual({
      ok: false,
      message: 'ツイートを編集できませんでした。時間をおいて再度お試しください',
    });
  });
});

describe('updateTweetAction', () => {
  it('成功したら表示を無効化し、移動せずに成功の状態を返す', async () => {
    const value = await openEdit();

    const state = await updateTweetAction(initialEditTweetState, form({ draftId: value.draftId, content: '新しい本文' }));

    expect(state).toEqual({ status: 'success', tweetId: TWEET, attempt: 1 });
    expect(store.tweets.get(TWEET)?.content).toBe('新しい本文');
    expect(boundary.calls).toEqual(['revalidate:/', 'revalidate:/profile/[displayId]:page', 'revalidate:/favorites']);
  });

  it('呼ぶたびに利用者を確認し、別アカウントに切り替わったら誰の投稿も変えない', async () => {
    const value = await openEdit();
    signIn(OTHER_ID);

    const state = await updateTweetAction(initialEditTweetState, form({ draftId: value.draftId, content: '乗っ取り' }));

    expect(state).toMatchObject({ status: 'error', code: 'FORBIDDEN', message: expect.stringContaining('編集できません') });
    expect(store.tweets.get(TWEET)?.content).toBe('元の本文');
    expect(boundary.calls).toEqual([]);
  });

  it('改変したpreviousState・hidden値（actorId・版・対象ID）では本人確認を回避できない', async () => {
    const value = await openEdit();
    signIn(OTHER_ID);
    const data = form({ draftId: value.draftId, content: '乗っ取り', actorId: FIXED_ID, revision: '0', tweetId: TWEET });
    const forged = { status: 'success', tweetId: TWEET, attempt: 9 } as const;

    const state = await updateTweetAction(forged, data);

    expect(state).toMatchObject({ code: 'FORBIDDEN', attempt: 10 });
    expect(store.tweets.get(TWEET)?.content).toBe('元の本文');
  });

  it('未ログインなら、編集用の通知を設定してログインへ移動する', async () => {
    const value = await openEdit();
    signIn(null);

    await expect(updateTweetAction(initialEditTweetState, form({ draftId: value.draftId, content: 'a' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(boundary.calls).toEqual([`cookie:${TWEET_FLASH_COOKIE}=edit-login-required`, 'redirect:/login']);
  });

  it('入力違反は欄エラー、未準備の画像は画像欄のエラーにする', async () => {
    const value = await openEdit();

    expect(await updateTweetAction(initialEditTweetState, form({ draftId: value.draftId, content: 'あ'.repeat(281) }))).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
      fieldErrors: { content: [expect.any(String)] },
    });
    expect(
      await updateTweetAction(
        initialEditTweetState,
        form({ draftId: value.draftId, content: 'a', uploadIds: ['00000000-0000-4000-8000-000000000999'] }),
      ),
    ).toMatchObject({ code: 'UPLOAD_NOT_READY', fieldErrors: { images: [expect.any(String)] } });
  });

  it('先に別の編集が確定していたら、競合の案内を返して何も変えない', async () => {
    const first = await openEdit();
    const second = await openEdit();
    await updateTweetAction(initialEditTweetState, form({ draftId: first.draftId, content: '先' }));

    const state = await updateTweetAction(initialEditTweetState, form({ draftId: second.draftId, content: '後' }));

    expect(state).toMatchObject({
      status: 'error',
      code: 'CONFLICT',
      message: '他の画面で更新されています。閉じて開き直してください',
    });
    expect(store.tweets.get(TWEET)?.content).toBe('先');
  });

  it.each([
    ['期限切れ', 'DRAFT_EXPIRED', '編集の準備が切れました。閉じて開き直してください'],
    ['対象の削除', 'NOT_FOUND', 'このツイートは見つかりませんでした。閉じてください'],
    ['DB障害', 'UNAVAILABLE', 'ツイートを更新できませんでした。時間をおいて再度お試しください'],
  ] as const)('%s は %s の案内にする', async (_label, code, message) => {
    const value = await openEdit();
    if (code === 'DRAFT_EXPIRED') store.drafts.get(value.draftId)!.expiresAt = NOW;
    if (code === 'NOT_FOUND') store.tweets.delete(TWEET);
    if (code === 'UNAVAILABLE') vi.spyOn(editor, 'commit').mockRejectedValueOnce(new Error('db down'));

    expect(await updateTweetAction(initialEditTweetState, form({ draftId: value.draftId, content: '更新' }))).toMatchObject({
      status: 'error',
      code,
      message,
    });
  });

  it.each([
    ['下書きIDの欠落', form({ content: 'a' })],
    ['重複した本文', form({ draftId: 'x', content: ['a', 'b'] })],
    ['Fileの保持画像ID', form({ draftId: 'x', content: 'a', keepImageIds: new Blob(['x']) })],
    ['Fileの新規画像ID', form({ draftId: 'x', content: 'a', uploadIds: new Blob(['x']) })],
  ])('不正な形式の送信（%s）は保存しない', async (_label, data) => {
    expect(await updateTweetAction(initialEditTweetState, data)).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(store.tweets.get(TWEET)?.content).toBe('元の本文');
  });
});
