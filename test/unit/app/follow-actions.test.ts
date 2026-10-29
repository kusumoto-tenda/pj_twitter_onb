import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/usecases/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { InMemoryFollowStore } from '@/test/support/in-memory-follow-store';
import type { InMemoryUserRepository } from '@/test/support/in-memory-user-repository';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const THIRD_ID = '00000000-0000-4000-8000-000000000003';
const NEW_ID = '00000000-0000-4000-8000-000000000900';
const NOW = new Date('2026-10-27T03:00:00.000Z');

const boundary = vi.hoisted(() => ({
  calls: [] as string[],
  session: null as unknown,
  accountDeps: undefined as unknown,
  followDeps: undefined as unknown,
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
vi.mock('@/main/container/account', () => ({ getAccountDependencies: () => boundary.accountDeps }));
vi.mock('@/main/container/follow', () => ({ getFollowDependencies: () => boundary.followDeps }));

const { setFollowAction } = await import('@/app/follows/actions');

let store: InMemoryFollowStore;
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

// 対象のフォロワー数・本人のフォロー数・両側の一覧・他ページでの状態が出るページすべて。
const REVALIDATE = ['revalidate:/', 'revalidate:/profile/[displayId]:page', 'revalidate:/favorites'];

beforeEach(async () => {
  boundary.calls.length = 0;
  const accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput); // FIXED_ID
  await createAccount(accounts.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  users = accounts.users;
  boundary.accountDeps = accounts.deps;
  store = new InMemoryFollowStore();
  store.addUser(FIXED_ID);
  store.addUser(OTHER_ID);
  store.addUser(THIRD_ID);
  boundary.followDeps = { follows: store, newId: () => NEW_ID, now: () => NOW };
  signIn(FIXED_ID);
});

describe('setFollowAction', () => {
  it('trueで登録・falseで解除して状態を返し、成功時だけメイン・全プロフィール・お気に入りを再取得させる', async () => {
    expect(await setFollowAction(form({ targetId: OTHER_ID, active: 'true', expectedActorId: FIXED_ID }))).toEqual({
      ok: true,
      active: true,
    });
    expect(store.follows).toEqual([{ id: NEW_ID, followerId: FIXED_ID, followId: OTHER_ID, createdAt: NOW }]);
    expect(boundary.calls).toEqual(REVALIDATE);

    boundary.calls.length = 0;
    expect(await setFollowAction(form({ targetId: OTHER_ID, active: 'false', expectedActorId: FIXED_ID }))).toEqual({
      ok: true,
      active: false,
    });
    expect(store.follows).toEqual([]);
    expect(boundary.calls).toEqual(REVALIDATE);
  });

  it('同じ登録の再送では既存の関係（UUID・日時）を保ち、解除済みの解除も成功にする', async () => {
    const existing = { id: '00000000-0000-4000-8000-000000000901', followerId: FIXED_ID, followId: OTHER_ID, createdAt: new Date(0) };
    store.follows.push(existing);

    expect(await setFollowAction(form({ targetId: OTHER_ID, active: 'true', expectedActorId: FIXED_ID }))).toEqual({ ok: true, active: true });
    expect(store.follows).toEqual([existing]);

    expect(await setFollowAction(form({ targetId: THIRD_ID, active: 'false', expectedActorId: FIXED_ID }))).toEqual({ ok: true, active: false });
    expect(store.follows).toEqual([existing]);
  });

  it('解除しても相手から自分への逆方向の関係は残す', async () => {
    const reverse = { id: '00000000-0000-4000-8000-000000000902', followerId: OTHER_ID, followId: FIXED_ID, createdAt: new Date(0) };
    store.follows.push(reverse);

    await setFollowAction(form({ targetId: OTHER_ID, active: 'true', expectedActorId: FIXED_ID }));
    await setFollowAction(form({ targetId: OTHER_ID, active: 'false', expectedActorId: FIXED_ID }));
    expect(store.follows).toEqual([reverse]);
  });

  it('フォローする利用者は送信内容ではなくセッションで決める（他人の名義・他人の関係へ差し替えられない）', async () => {
    const others = { id: '00000000-0000-4000-8000-000000000903', followerId: OTHER_ID, followId: THIRD_ID, createdAt: NOW };
    store.follows.push(others);

    await setFollowAction(form({ targetId: THIRD_ID, active: 'false', expectedActorId: FIXED_ID, actorId: OTHER_ID, followerId: OTHER_ID }));
    expect(store.follows).toEqual([others]);

    await setFollowAction(form({ targetId: THIRD_ID, active: 'true', expectedActorId: FIXED_ID, followerId: OTHER_ID, id: others.id }));
    expect(store.follows.map((f) => [f.followerId, f.followId])).toEqual([
      [OTHER_ID, THIRD_ID],
      [FIXED_ID, THIRD_ID],
    ]);
    expect(store.follows[1].id).toBe(NEW_ID);
  });

  it.each([
    ['activeがない', form({ targetId: OTHER_ID, expectedActorId: FIXED_ID })],
    ['activeが真偽値の文字列でない', form({ targetId: OTHER_ID, active: 'yes', expectedActorId: FIXED_ID })],
    ['activeが大文字', form({ targetId: OTHER_ID, active: 'TRUE', expectedActorId: FIXED_ID })],
    ['activeが1', form({ targetId: OTHER_ID, active: '1', expectedActorId: FIXED_ID })],
    ['activeが空', form({ targetId: OTHER_ID, active: '', expectedActorId: FIXED_ID })],
    ['activeが複数', form({ targetId: OTHER_ID, active: ['true', 'false'], expectedActorId: FIXED_ID })],
    ['activeがファイル', form({ targetId: OTHER_ID, active: new Blob(['true']), expectedActorId: FIXED_ID })],
    ['対象がない', form({ active: 'true', expectedActorId: FIXED_ID })],
    ['対象が複数', form({ targetId: [OTHER_ID, THIRD_ID], active: 'true', expectedActorId: FIXED_ID })],
    ['対象がファイル', form({ targetId: new Blob([OTHER_ID]), active: 'true', expectedActorId: FIXED_ID })],
    ['対象がUUIDでない', form({ targetId: 'Bob_12', active: 'true', expectedActorId: FIXED_ID })],
    ['画面の利用者が複数', form({ targetId: OTHER_ID, active: 'true', expectedActorId: [FIXED_ID, FIXED_ID] })],
    ['画面の利用者がファイル', form({ targetId: OTHER_ID, active: 'true', expectedActorId: new Blob([FIXED_ID]) })],
  ])('改ざんされた送信（%s）は変更しない', async (_label, data) => {
    expect(await setFollowAction(data)).toEqual({
      ok: false,
      message: 'フォローを変更できませんでした。画面を開き直してください',
    });
    expect(store.follows).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });

  it('未ログイン（セッションだけ残った利用者を含む）ならログイン画面へ移動せず、案内だけを返す', async () => {
    for (const id of [null, '00000000-0000-4000-8000-00000000dead']) {
      signIn(id);
      expect(await setFollowAction(form({ targetId: OTHER_ID, active: 'true' }))).toEqual({
        ok: false,
        message: 'ログイン中のみフォローできます',
      });
    }
    expect(store.follows).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });

  it('自分自身（UUIDの大小文字違いを含む）はフォローできない', async () => {
    for (const targetId of [FIXED_ID, FIXED_ID.toUpperCase()]) {
      expect(await setFollowAction(form({ targetId, active: 'true', expectedActorId: FIXED_ID }))).toEqual({
        ok: false,
        message: '自分自身はフォローできません',
      });
    }
    expect(store.follows).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });

  it.each([
    ['別の利用者で表示した画面', OTHER_ID],
    ['未ログインで表示した画面', undefined],
  ])('%sから送られたら、誰の関係も変えない', async (_label, expected) => {
    const others = { id: '00000000-0000-4000-8000-000000000904', followerId: OTHER_ID, followId: THIRD_ID, createdAt: NOW };
    store.follows.push(others);
    const fields: Record<string, string> = { targetId: THIRD_ID, active: 'false' };
    if (expected) fields.expectedActorId = expected;

    expect(await setFollowAction(form(fields))).toEqual({
      ok: false,
      message: 'ログイン中の利用者が変わりました。画面を開き直してください',
    });
    expect(store.follows).toEqual([others]);
    expect(boundary.calls).toEqual([]);
  });

  it('対象の利用者がいなければ理由を返し、消えたプロフィールを表示し続けないよう再取得させる', async () => {
    store.removeUser(THIRD_ID);
    expect(await setFollowAction(form({ targetId: THIRD_ID, active: 'true', expectedActorId: FIXED_ID }))).toEqual({
      ok: false,
      message: 'このユーザーは見つかりませんでした',
    });
    expect(store.follows).toEqual([]);
    expect(boundary.calls).toEqual(REVALIDATE);
  });

  it('DB・利用者確認の障害は再試行の案内にし、再取得させない', async () => {
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('db down'));
    const retry = { ok: false, message: 'フォローを変更できませんでした。時間をおいて再度お試しください' };
    expect(await setFollowAction(form({ targetId: OTHER_ID, active: 'true', expectedActorId: FIXED_ID }))).toEqual(retry);

    users.findById = async () => {
      throw new Error('db down');
    };
    expect(await setFollowAction(form({ targetId: OTHER_ID, active: 'true', expectedActorId: FIXED_ID }))).toEqual(retry);
    expect(store.follows).toEqual([]);
    expect(boundary.calls).toEqual([]);
  });
});
