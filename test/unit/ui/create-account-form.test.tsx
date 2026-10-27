import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreateAccountFormState } from '@/app/signin/form-state';
import { CreateAccountForm } from '@/app/ui/account/create-account-form';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type Action = (state: CreateAccountFormState, formData: FormData) => Promise<CreateAccountFormState>;

function errorState(overrides: Partial<Extract<CreateAccountFormState, { status: 'error' }>> = {}) {
  return {
    status: 'error',
    code: 'INVALID_INPUT',
    fieldErrors: {},
    values: { name: '', displayId: '' },
    attempt: 1,
    ...overrides,
  } as CreateAccountFormState;
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('ユーザーID'), 'ab');
  await user.type(screen.getByLabelText('名前'), 'アリス');
  await user.type(screen.getByLabelText('パスワード'), 'secret-pw');
  await user.click(screen.getByRole('button', { name: 'アカウントを作成' }));
}

describe('CreateAccountForm', () => {
  it('ID・名前・パスワード欄だけを表示し、自己紹介は求めない', () => {
    render(<CreateAccountForm action={vi.fn()} />);

    expect(screen.getByLabelText('ユーザーID')).toHaveAttribute('name', 'displayId');
    expect(screen.getByLabelText('名前')).toHaveAttribute('name', 'name');
    expect(screen.queryByLabelText(/自己紹介/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'アカウントを作成' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'ログイン' })).toHaveAttribute('href', '/login');
  });

  it('送信した入力をActionに渡す', async () => {
    const action = vi.fn<Action>().mockResolvedValue(errorState());
    render(<CreateAccountForm action={action} />);

    await fillAndSubmit();

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = action.mock.calls[0][1];
    expect(Object.fromEntries(data)).toEqual({
      displayId: 'ab',
      name: 'アリス',
      password: 'secret-pw',
    });
  });

  it('送信中は登録ボタンを無効化する', async () => {
    let finish: (state: CreateAccountFormState) => void = () => {};
    const action = vi.fn<Action>(() => new Promise((resolve) => (finish = resolve)));
    render(<CreateAccountForm action={action} />);

    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /アカウントを作成/ })).toBeDisabled(),
    );
    // 未完了のトランジションが後続のテストに絡まないよう完了させる。
    finish(errorState());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'アカウントを作成' })).toBeEnabled(),
    );
  });

  it('失敗時は欄のエラーと上部の失敗通知を同時に表示し、パスワード以外の入力を保持する', async () => {
    const action = vi.fn<Action>().mockResolvedValue(
      errorState({
        fieldErrors: { displayId: ['ユーザーIDは5文字以上15文字以下で入力してください'] },
        values: { name: 'アリス', displayId: 'ab' },
      }),
    );
    render(<CreateAccountForm action={action} />);

    await fillAndSubmit();

    // 失敗のたびにフォームを再マウントするため、要素は結果の反映後に取り直す。
    await waitFor(() =>
      expect(screen.getByLabelText('ユーザーID')).toHaveAttribute('aria-invalid', 'true'),
    );
    const idInput = screen.getByLabelText('ユーザーID');
    const describedBy = idInput.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)).toHaveTextContent(
      'ユーザーIDは5文字以上15文字以下で入力してください',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('アカウントの作成に失敗しました');
    expect(screen.getByLabelText('ユーザーID')).toHaveValue('ab');
    expect(screen.getByLabelText('名前')).toHaveValue('アリス');
    expect(screen.queryByLabelText(/自己紹介/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toHaveValue('');
    expect(screen.getByLabelText('名前')).toHaveAttribute('aria-invalid', 'false');
  });

  it('登録後のログイン失敗時は作成済みであることとログイン画面への導線を表示する', async () => {
    const action = vi
      .fn<Action>()
      .mockResolvedValue(errorState({ code: 'ACCOUNT_CREATED_SESSION_FAILED' }));
    render(<CreateAccountForm action={action} />);

    await fillAndSubmit();

    expect(
      await screen.findByText('アカウントは作成済みです。ログインしてください'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('アカウントの作成に失敗しました');
    expect(screen.getByRole('link', { name: 'ログイン画面へ' })).toHaveAttribute('href', '/login');
  });
});
