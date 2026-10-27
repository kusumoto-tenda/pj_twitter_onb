import { CredentialsSignin } from 'next-auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryUserRepository } from '@/test/support/in-memory-user-repository';
import { createTestDependencies, validInput } from '@/test/support/account-fixtures';

const boundary = vi.hoisted(() => ({
  calls: [] as string[],
  cookieSet: vi.fn(),
  signIn: vi.fn(),
  deps: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    boundary.calls.push(`redirect:${url}`);
    throw new Error('NEXT_REDIRECT');
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
vi.mock('@/app/_auth/auth', () => ({
  signIn: (...args: unknown[]) => {
    boundary.calls.push('signIn');
    return boundary.signIn(...args);
  },
}));
vi.mock('@/app/_composition/account', () => ({
  getAccountDependencies: () => boundary.deps,
}));

const { createAccountAction } = await import('@/app/signin/actions');
const { parseCreateAccountForm } = await import('@/app/signin/parse-form');
const { loginAction } = await import('@/app/login/actions');
const { initialCreateAccountState } = await import('@/app/signin/form-state');
const { initialLoginState } = await import('@/app/login/form-state');
const { FLASH_COOKIE, ACCOUNT_CREATED_FLASH } = await import('@/app/ui/notifications/flash');

function form(fields: Record<string, string | string[] | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const validForm = () =>
  form({
    name: validInput.name,
    displayId: validInput.displayId,
    bio: validInput.bio ?? '',
    password: validInput.password,
  });

let users: InMemoryUserRepository;

beforeEach(() => {
  boundary.calls.length = 0;
  boundary.cookieSet.mockReset();
  boundary.signIn.mockReset().mockResolvedValue('http://localhost:3000/');
  const context = createTestDependencies();
  users = context.users;
  boundary.deps = context.deps;
});

describe('parseCreateAccountForm', () => {
  it('文字列の各欄を入力に変換し、余計な欄は採用しない', () => {
    const data = validForm();
    data.append('id', 'attacker-uuid');
    data.append('createdAt', '2000-01-01');
    data.append('passwordHash', 'x');

    expect(parseCreateAccountForm(data)).toEqual({ ok: true, input: validInput });
  });

  it('ブラウザが送るCRLFの改行をLFに揃える', () => {
    const data = form({ name: 'a', displayId: 'Alice_1', bio: '一行目\r\n二行目', password: 'password123' });

    expect(parseCreateAccountForm(data)).toMatchObject({ ok: true, input: { bio: '一行目\n二行目' } });
  });

  it('bioの欠落は空文字として扱う', () => {
    const data = form({ name: 'a', displayId: 'Alice_1', password: 'password123' });

    expect(parseCreateAccountForm(data)).toEqual({
      ok: true,
      input: { name: 'a', displayId: 'Alice_1', bio: '', password: 'password123' },
    });
  });

  it.each([
    ['必須欄の欠落', form({ name: 'a', displayId: 'Alice_1' })],
    ['Fileの送信', form({ name: new Blob(['a']), displayId: 'Alice_1', password: 'password123' })],
    ['重複キー', form({ name: ['a', 'b'], displayId: 'Alice_1', password: 'password123' })],
  ])('%sは拒否する', (_label, data) => {
    expect(parseCreateAccountForm(data)).toEqual({ ok: false });
  });
});

describe('createAccountAction', () => {
  it('自己紹介の欄がない登録でも、空の自己紹介でアカウントを作成する', async () => {
    const data = validForm();
    data.delete('bio');

    await expect(createAccountAction(initialCreateAccountState, data)).rejects.toThrow('NEXT_REDIRECT');

    expect(users.accounts).toHaveLength(1);
    expect(users.accounts[0].bio).toBe('');
    expect(boundary.signIn).toHaveBeenCalledTimes(1);
  });

  it('成功時は登録後にCredentials認証し、通知Cookieを設定してから / へredirectする', async () => {
    await expect(createAccountAction(initialCreateAccountState, validForm())).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(users.accounts).toHaveLength(1);
    expect(boundary.signIn).toHaveBeenCalledWith('credentials', {
      displayId: 'Alice_1',
      password: 'password123',
      redirect: false,
    });
    expect(boundary.calls).toEqual(['signIn', `cookie:${FLASH_COOKIE}`, 'redirect:/']);
    expect(boundary.cookieSet).toHaveBeenCalledWith(
      FLASH_COOKIE,
      ACCOUNT_CREATED_FLASH,
      expect.objectContaining({ path: '/', sameSite: 'lax', httpOnly: false }),
    );
  });

  it('入力違反なら項目エラーと入力値（パスワード以外）を返し、認証・redirectしない', async () => {
    const data = form({ name: '', displayId: 'ab', password: 'secret-pw' });

    const state = await createAccountAction(initialCreateAccountState, data);

    expect(state).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
      fieldErrors: { name: expect.any(Array), displayId: expect.any(Array) },
      values: { name: '', displayId: 'ab' },
    });
    expect(JSON.stringify(state)).not.toContain('secret-pw');
    expect(boundary.calls).toEqual([]);
  });

  it('IDの重複はID欄のエラーにする', async () => {
    await createAccountAction(initialCreateAccountState, validForm()).catch(() => {});
    boundary.calls.length = 0;

    const data = validForm();
    data.set('displayId', 'alice_1');
    const state = await createAccountAction(initialCreateAccountState, data);

    expect(state).toMatchObject({
      status: 'error',
      code: 'DISPLAY_ID_TAKEN',
      fieldErrors: { displayId: [expect.stringContaining('既に使われています')] },
    });
    expect(users.accounts).toHaveLength(1);
    expect(boundary.calls).toEqual([]);
  });

  it('保存障害は UNAVAILABLE にし、認証・redirectしない', async () => {
    vi.spyOn(users, 'create').mockRejectedValue(new Error('db down'));

    const state = await createAccountAction(initialCreateAccountState, validForm());

    expect(state).toMatchObject({ status: 'error', code: 'UNAVAILABLE', fieldErrors: {} });
    expect(boundary.calls).toEqual([]);
  });

  it('不正な形式の送信は認証・redirectしない', async () => {
    const state = await createAccountAction(
      initialCreateAccountState,
      form({ name: ['a', 'b'], displayId: 'Alice_1', password: 'password123' }),
    );

    expect(state).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(users.accounts).toHaveLength(0);
    expect(boundary.calls).toEqual([]);
  });

  it('失敗のたびにattemptを増やし、同じエラーの再送でも通知を再表示できる', async () => {
    const data = form({ name: '', displayId: 'Alice_1', password: 'password123' });

    const first = await createAccountAction(initialCreateAccountState, data);
    const second = await createAccountAction(first, data);

    expect(first.status === 'error' && first.attempt).toBe(1);
    expect(second.status === 'error' && second.attempt).toBe(2);
  });

  it.each([
    ['認証エラー', () => Promise.reject(new CredentialsSignin())],
    ['想定外の結果', () => Promise.resolve('http://localhost:3000/api/auth/error?error=Configuration')],
    ['想定外の型', () => Promise.resolve(undefined)],
  ])(
    '登録後の自動ログインが失敗（%s）したらACCOUNT_CREATED_SESSION_FAILEDを返し、ユーザーを削除・再作成しない',
    async (_label, signInResult) => {
      boundary.signIn.mockImplementation(signInResult);

      const state = await createAccountAction(initialCreateAccountState, validForm());

      expect(state).toMatchObject({ status: 'error', code: 'ACCOUNT_CREATED_SESSION_FAILED' });
      expect(users.accounts).toHaveLength(1);
      expect(boundary.calls).toEqual(['signIn']);
    },
  );
});

describe('loginAction', () => {
  const credentialsError = 'ユーザーIDまたはパスワードが違います';

  it('成功時のみ / へredirectし、遷移の例外を失敗stateに変換しない', async () => {
    const data = form({ displayId: 'Alice_1', password: 'password123' });

    await expect(loginAction(initialLoginState, data)).rejects.toThrow('NEXT_REDIRECT');

    expect(boundary.signIn).toHaveBeenCalledWith('credentials', {
      displayId: 'Alice_1',
      password: 'password123',
      redirect: false,
    });
    expect(boundary.calls).toEqual(['signIn', 'redirect:/']);
  });

  it('空欄では認証せず、項目エラーを返す', async () => {
    const state = await loginAction(initialLoginState, form({ displayId: '', password: '' }));

    expect(state).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
      fieldErrors: { displayId: expect.any(Array), password: expect.any(Array) },
    });
    expect(boundary.signIn).not.toHaveBeenCalled();
  });

  it('ID形式違反では認証せず、ID欄のエラーとIDを返し、パスワードを含めない', async () => {
    const state = await loginAction(
      initialLoginState,
      form({ displayId: '@alice', password: 'secret-pw' }),
    );

    expect(state).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
      fieldErrors: { displayId: expect.any(Array) },
      displayId: '@alice',
    });
    expect(state.status === 'error' && state.fieldErrors.password).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('secret-pw');
    expect(boundary.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['必須欄の欠落', form({ displayId: 'Alice_1' })],
    ['Fileの送信', form({ displayId: 'Alice_1', password: new Blob(['password123']) })],
    ['重複キー', form({ displayId: 'Alice_1', password: ['password123', 'other-pass'] })],
  ])('%sは一般的な入力エラーにし、認証しない', async (_label, data) => {
    const state = await loginAction(initialLoginState, data);

    expect(state).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
      message: expect.stringContaining('入力内容'),
      fieldErrors: {},
    });
    expect(JSON.stringify(state)).not.toContain('password123');
    expect(boundary.calls).toEqual([]);
  });

  it.each([
    ['CredentialsSigninのthrow', () => Promise.reject(new CredentialsSignin())],
    [
      'CredentialsSigninのエラーURL',
      () => Promise.resolve('http://localhost:3000/login?error=CredentialsSignin&code=credentials'),
    ],
  ])('資格情報の不一致（%s）はINVALID_CREDENTIALSにし、IDだけを保持する', async (_label, result) => {
    boundary.signIn.mockImplementation(result);
    const data = form({ displayId: 'Alice_1', password: 'wrong-pass' });

    const state = await loginAction(initialLoginState, data);

    expect(state).toMatchObject({
      status: 'error',
      code: 'INVALID_CREDENTIALS',
      message: credentialsError,
      fieldErrors: {},
      displayId: 'Alice_1',
    });
    expect(JSON.stringify(state)).not.toContain('wrong-pass');
    expect(boundary.calls).toEqual(['signIn']);
  });

  it.each([
    ['想定外の例外', () => Promise.reject(new Error('db down'))],
    ['無効な戻り値', () => Promise.resolve(undefined)],
    ['設定エラーのURL', () => Promise.resolve('http://localhost:3000/api/auth/error?error=Configuration')],
  ])('%sはUNAVAILABLEにし、資格情報の不一致と区別する', async (_label, result) => {
    boundary.signIn.mockImplementation(result);

    const state = await loginAction(
      initialLoginState,
      form({ displayId: 'Alice_1', password: 'password123' }),
    );

    expect(state).toMatchObject({
      status: 'error',
      code: 'UNAVAILABLE',
      message: 'ログインできませんでした。時間をおいて再度お試しください',
      displayId: 'Alice_1',
    });
    expect(boundary.calls).toEqual(['signIn']);
  });

  it('再送のたびにattemptが増え、IDだけを保持する', async () => {
    boundary.signIn.mockRejectedValue(new CredentialsSignin());
    const data = form({ displayId: 'Alice_1', password: 'wrong-pass' });

    const first = await loginAction(initialLoginState, data);
    const second = await loginAction(first, data);

    expect(first).toMatchObject({ attempt: 1, displayId: 'Alice_1' });
    expect(second).toMatchObject({ attempt: 2, displayId: 'Alice_1' });
  });
});
