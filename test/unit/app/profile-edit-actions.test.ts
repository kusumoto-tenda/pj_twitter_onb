import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/usecases/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { InMemoryUserRepository } from '@/test/support/in-memory-user-repository';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';

const boundary = vi.hoisted(() => ({
  calls: [] as string[],
  cookieSet: vi.fn(),
  session: null as unknown,
  deps: undefined as unknown,
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
      boundary.calls.push(`cookie:${String(args[0])}`);
      boundary.cookieSet(...args);
    },
  })),
}));
vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/main/container/account', () => ({ getAccountDependencies: () => boundary.deps }));

const { updateProfileAction } = await import('@/app/profile/[displayId]/edit/actions');
const { parseProfileEditForm } = await import('@/app/profile/[displayId]/edit/parse-form');
const { initialProfileEditState } = await import('@/app/profile/[displayId]/edit/form-state');
const { PROFILE_UPDATED_COOKIE, PROFILE_UPDATED_FLASH, FLASH_COOKIE } = await import(
  '@/app/ui/notifications/flash'
);

function form(fields: Record<string, string | string[] | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const validForm = (overrides: Record<string, string> = {}) =>
  form({ name: 'アリス改', displayId: 'Alice_99', bio: '変更後', ...overrides });

let users: InMemoryUserRepository;

function signIn(id: string | null) {
  boundary.session = id ? { user: { id }, expires: '2099-01-01T00:00:00Z' } : null;
}

beforeEach(async () => {
  boundary.calls.length = 0;
  boundary.cookieSet.mockReset();
  const context = createTestDependencies();
  await createAccount(context.deps, validInput); // FIXED_ID: Alice_1
  await createAccount(context.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  users = context.users;
  boundary.deps = context.deps;
  signIn(FIXED_ID);
});

describe('parseProfileEditForm', () => {
  it('3項目だけを採用し、UUID・作成日・hash・actorIdなどの余計な欄は無視する', () => {
    const data = validForm();
    for (const key of ['id', 'owner', 'actorId', 'createdAt', 'passwordHash']) data.append(key, 'x');

    expect(parseProfileEditForm(data)).toEqual({
      ok: true,
      input: { name: 'アリス改', displayId: 'Alice_99', bio: '変更後' },
    });
  });

  it('ブラウザが送るCRLFの改行をLFに揃える（前後の空白は保持する）', () => {
    expect(parseProfileEditForm(form({ name: 'a', displayId: 'Alice_1', bio: ' 一行目\r\n二行目\r ' }))).toEqual({
      ok: true,
      input: { name: 'a', displayId: 'Alice_1', bio: ' 一行目\n二行目\n ' },
    });
  });

  it('bioの欠落は空文字にする', () => {
    expect(parseProfileEditForm(form({ name: 'a', displayId: 'Alice_1' }))).toEqual({
      ok: true,
      input: { name: 'a', displayId: 'Alice_1', bio: '' },
    });
  });

  it.each([
    ['必須欄の欠落', form({ name: 'a' })],
    ['Fileの送信', form({ name: new Blob(['a']), displayId: 'Alice_1' })],
    ['重複キー', form({ name: ['a', 'b'], displayId: 'Alice_1' })],
  ])('%sは拒否する', (_label, data) => {
    expect(parseProfileEditForm(data)).toEqual({ ok: false });
  });
});

describe('updateProfileAction', () => {
  it('成功時はキャッシュ無効化→通知Cookie設定→新しいIDのプロフィールへredirectの順に行う', async () => {
    await expect(
      updateProfileAction(FIXED_ID, initialProfileEditState, validForm()),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(users.accounts[0]).toMatchObject({ name: 'アリス改', displayId: 'Alice_99', bio: '変更後' });
    expect(boundary.calls).toEqual([
      'revalidate:/',
      'revalidate:/profile/[displayId]:page',
      'revalidate:/profile/[displayId]/edit:page',
      'revalidate:/favorites',
      `cookie:${PROFILE_UPDATED_COOKIE}`,
      'redirect:/profile/Alice_99',
    ]);
    expect(PROFILE_UPDATED_COOKIE).not.toBe(FLASH_COOKIE);
    expect(boundary.cookieSet).toHaveBeenCalledWith(
      PROFILE_UPDATED_COOKIE,
      PROFILE_UPDATED_FLASH,
      expect.objectContaining({ path: '/', sameSite: 'lax', httpOnly: false }),
    );
  });

  it('呼ぶたびに閲覧者を取り直し、表示後に別アカウントへ変わったら誰も更新しない', async () => {
    const before = structuredClone(users.accounts);
    signIn(OTHER_ID); // フォームはFIXED_IDの画面で表示されたが、今はOTHER_IDでログイン中

    const state = await updateProfileAction(FIXED_ID, initialProfileEditState, validForm());

    expect(state).toMatchObject({
      status: 'error',
      code: 'FORBIDDEN',
      message: 'このプロフィールは編集できません',
    });
    expect(users.accounts).toEqual(before);
    expect(boundary.calls).toEqual([]);
  });

  it('未認証なら更新せず /login へredirectする', async () => {
    signIn(null);
    const before = structuredClone(users.accounts);

    await expect(
      updateProfileAction(FIXED_ID, initialProfileEditState, validForm()),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(boundary.calls).toEqual(['redirect:/login']);
    expect(users.accounts).toEqual(before);
  });

  it('セッションだけ残った利用者は未認証として扱う', async () => {
    signIn('00000000-0000-4000-8000-00000000dead');

    await expect(
      updateProfileAction('00000000-0000-4000-8000-00000000dead', initialProfileEditState, validForm()),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(boundary.calls).toEqual(['redirect:/login']);
  });

  it('利用者の確認に失敗したら更新せずUNAVAILABLEを返す', async () => {
    vi.spyOn(users, 'findById').mockRejectedValue(new Error('db down'));
    const update = vi.spyOn(users, 'updateProfile');

    const state = await updateProfileAction(FIXED_ID, initialProfileEditState, validForm());

    expect(state).toMatchObject({ status: 'error', code: 'UNAVAILABLE' });
    expect(update).not.toHaveBeenCalled();
  });

  it('入力違反は欄エラーにし、入力値を保持する', async () => {
    const state = await updateProfileAction(
      FIXED_ID,
      initialProfileEditState,
      form({ name: '', displayId: 'ab', bio: 'そのまま' }),
    );

    expect(state).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
      fieldErrors: { name: expect.any(Array), displayId: expect.any(Array) },
      values: { name: '', displayId: 'ab', bio: 'そのまま' },
    });
    expect(boundary.calls).toEqual([]);
  });

  it('他人のIDとの重複はID欄のエラーにし、何も変えない', async () => {
    const before = structuredClone(users.accounts);

    const state = await updateProfileAction(
      FIXED_ID,
      initialProfileEditState,
      validForm({ displayId: 'BOB_12' }),
    );

    expect(state).toMatchObject({
      status: 'error',
      code: 'DISPLAY_ID_TAKEN',
      fieldErrors: { displayId: ['このユーザーIDは既に使われています'] },
      values: { displayId: 'BOB_12' },
    });
    expect(users.accounts).toEqual(before);
  });

  it('DB障害はフォーム全体のメッセージにする', async () => {
    vi.spyOn(users, 'updateProfile').mockRejectedValue(new Error('db down'));

    const state = await updateProfileAction(FIXED_ID, initialProfileEditState, validForm());

    expect(state).toMatchObject({
      status: 'error',
      code: 'UNAVAILABLE',
      message: '保存できませんでした。時間をおいて再度お試しください',
      fieldErrors: {},
    });
  });

  it('対象が見つからなければ保存成功とは扱わない', async () => {
    vi.spyOn(users, 'updateProfile').mockResolvedValue({ status: 'not-found' });

    const state = await updateProfileAction(FIXED_ID, initialProfileEditState, validForm());

    expect(state).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'アカウントを確認できません。再度ログインしてください',
    });
    expect(boundary.calls).toEqual([]);
  });

  it('不正な形式の送信は認証より前に拒否し、更新しない', async () => {
    const update = vi.spyOn(users, 'updateProfile');

    const state = await updateProfileAction(
      FIXED_ID,
      initialProfileEditState,
      form({ name: ['a', 'b'], displayId: 'Alice_1' }),
    );

    expect(state).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(update).not.toHaveBeenCalled();
  });

  it('previousStateやhidden値を改変しても本人確認を回避できない', async () => {
    signIn(OTHER_ID);
    const tampered = validForm();
    tampered.append('actorId', FIXED_ID);
    const forgedPrevious = {
      status: 'error',
      code: 'INVALID_INPUT',
      message: '',
      fieldErrors: {},
      values: { name: '', displayId: '', bio: '' },
      attempt: 99,
    } as const;

    const state = await updateProfileAction(FIXED_ID, forgedPrevious, tampered);

    expect(state).toMatchObject({ code: 'FORBIDDEN', attempt: 100 });
    expect(users.accounts[0].name).toBe(validInput.name);
  });
});
