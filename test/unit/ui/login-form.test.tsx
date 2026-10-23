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
      message: 'ユーザーIDまたはパスワードが違います',
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
});
