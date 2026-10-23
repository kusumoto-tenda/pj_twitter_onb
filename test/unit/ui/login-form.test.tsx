import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LoginFormState } from '@/app/login/form-state';
import { LoginForm } from '@/app/ui/account/login-form';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type Action = (state: LoginFormState, formData: FormData) => Promise<LoginFormState>;

describe('LoginForm', () => {
  it('ID・パスワード欄、ログインボタン、登録画面へのリンクを表示する', () => {
    render(<LoginForm action={vi.fn()} />);

    expect(screen.getByLabelText('ユーザーID')).toHaveAttribute('name', 'displayId');
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'サインイン' })).toHaveAttribute('href', '/signin');
  });

  it('失敗時はメッセージを表示し、IDだけを保持する', async () => {
    const action = vi.fn<Action>().mockResolvedValue({
      status: 'error',
      code: 'INVALID_CREDENTIALS',
      message: 'ユーザーIDまたはパスワードが違います',
      fieldErrors: {},
      displayId: 'Alice_1',
      attempt: 1,
    });
    render(<LoginForm action={action} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('ユーザーID'), 'Alice_1');
    await user.type(screen.getByLabelText('パスワード'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ユーザーIDまたはパスワードが違います',
    );
    expect(Object.fromEntries(action.mock.calls[0][1])).toEqual({
      displayId: 'Alice_1',
      password: 'wrong-pass',
    });
    await waitFor(() => expect(screen.getByLabelText('ユーザーID')).toHaveValue('Alice_1'));
    expect(screen.getByLabelText('パスワード')).toHaveValue('');
  });

  it('入力違反では欄ごとのエラーをaria属性で入力欄に関連付ける', async () => {
    const action = vi.fn<Action>().mockResolvedValue({
      status: 'error',
      code: 'INVALID_INPUT',
      message: '',
      fieldErrors: {
        displayId: ['ユーザーIDは5文字以上15文字以下で入力してください'],
        password: ['パスワードは8文字以上50文字以下で入力してください'],
      },
      displayId: '',
      attempt: 1,
    });
    render(<LoginForm action={action} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'ログイン' }));

    // 失敗のたびにフォームを再マウントするため、要素は結果の反映後に取り直す。
    await waitFor(() =>
      expect(screen.getByLabelText('ユーザーID')).toHaveAttribute('aria-invalid', 'true'),
    );
    for (const [label, message] of [
      ['ユーザーID', 'ユーザーIDは5文字以上15文字以下で入力してください'],
      ['パスワード', 'パスワードは8文字以上50文字以下で入力してください'],
    ]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent(
        message,
      );
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('送信中は「ログイン中…」を表示してボタンを無効にし、追加クリックで再送しない', async () => {
    let finish: (state: LoginFormState) => void = () => {};
    const action = vi.fn<Action>(() => new Promise((resolve) => (finish = resolve)));
    render(<LoginForm action={action} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('ユーザーID'), 'Alice_1');
    await user.type(screen.getByLabelText('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    const pending = await screen.findByRole('button', { name: 'ログイン中…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    await user.click(pending);
    expect(action).toHaveBeenCalledTimes(1);

    // 未完了のトランジションが後続のテストに絡まないよう完了させる。
    finish({ status: 'idle' });
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeEnabled();
  });

  it('同じ認証エラーで連続して失敗しても、メッセージと再入力欄を正しく表示する', async () => {
    const failure = (attempt: number): LoginFormState => ({
      status: 'error',
      code: 'INVALID_CREDENTIALS',
      message: 'ユーザーIDまたはパスワードが違います',
      fieldErrors: {},
      displayId: 'Alice_1',
      attempt,
    });
    const action = vi
      .fn<Action>()
      .mockResolvedValueOnce(failure(1))
      .mockResolvedValueOnce(failure(2));
    render(<LoginForm action={action} />);
    const user = userEvent.setup();

    for (const attempt of [1, 2]) {
      if (attempt === 1) await user.type(screen.getByLabelText('ユーザーID'), 'Alice_1');
      await user.type(screen.getByLabelText('パスワード'), 'wrong-pass');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      await waitFor(() => expect(action).toHaveBeenCalledTimes(attempt));
      await waitFor(() => expect(screen.getByLabelText('パスワード')).toHaveValue(''));
      expect(screen.getByRole('alert')).toHaveTextContent('ユーザーIDまたはパスワードが違います');
      expect(screen.getByLabelText('ユーザーID')).toHaveValue('Alice_1');
    }
    expect(Object.fromEntries(action.mock.calls[1][1])).toEqual({
      displayId: 'Alice_1',
      password: 'wrong-pass',
    });
  });
});
