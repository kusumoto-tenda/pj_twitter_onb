import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AccountDeleteFormState } from '@/app/profile/[displayId]/delete/form-state';
import { AccountDeleteForm } from '@/app/ui/profile/account-delete-form';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type Action = (state: AccountDeleteFormState, formData: FormData) => Promise<AccountDeleteFormState>;

function failure(overrides: Partial<Extract<AccountDeleteFormState, { status: 'error' }>> = {}) {
  return {
    status: 'error',
    code: 'INVALID_PASSWORD',
    message: '',
    fieldErrors: { password: ['パスワードが違います'] },
    attempt: 1,
    ...overrides,
  } as AccountDeleteFormState;
}

function renderForm(action: Action = vi.fn()) {
  render(
    <AccountDeleteForm
      action={action}
      account={{ name: 'アリス', displayId: 'Alice_1' }}
      cancelHref="/profile/Alice_1"
    />,
  );
}

describe('AccountDeleteForm', () => {
  it('現在の利用者・削除の影響・パスワード欄・戻る・削除ボタンを表示する', () => {
    renderForm();

    expect(screen.getByRole('heading', { name: 'パスワードを確認' })).toBeInTheDocument();
    expect(screen.getByText('登録しているパスワードを入力してください')).toBeInTheDocument();
    expect(
      screen.getByText('削除するとアカウント・投稿・フォロー関係・リツイートは元に戻せません'),
    ).toBeInTheDocument();
    expect(screen.getByText('アリス')).toBeInTheDocument();
    expect(screen.getByText('@Alice_1')).toBeInTheDocument();
    const password = screen.getByLabelText('パスワード');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: '戻る' })).toHaveAttribute('href', '/profile/Alice_1');
    expect(screen.getByRole('button', { name: 'アカウント削除' })).toBeEnabled();
  });

  it('誤パスワードは欄エラーとして表示し、失敗後はパスワードを空にする', async () => {
    const action = vi.fn<Action>().mockResolvedValue(failure());
    renderForm(action);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('パスワード'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'アカウント削除' }));

    await waitFor(() =>
      expect(screen.getByLabelText('パスワード')).toHaveAttribute('aria-invalid', 'true'),
    );
    const password = screen.getByLabelText('パスワード');
    expect(document.getElementById(password.getAttribute('aria-describedby')!)).toHaveTextContent(
      'パスワードが違います',
    );
    expect(password).toHaveValue('');
    expect(action.mock.calls[0][1].get('password')).toBe('wrong-pass');
  });

  it('障害などはフォーム全体のメッセージとして表示する', async () => {
    const action = vi.fn<Action>().mockResolvedValue(
      failure({
        code: 'UNAVAILABLE',
        message: '削除できませんでした。時間をおいて再度お試しください',
        fieldErrors: {},
      }),
    );
    renderForm(action);

    await userEvent.setup().click(screen.getByRole('button', { name: 'アカウント削除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('削除できませんでした');
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('aria-invalid', 'false');
  });

  it('削除中は「削除中…」と表示してボタンを無効にし、追加クリックで再送しない', async () => {
    let finish: (state: AccountDeleteFormState) => void = () => {};
    const action = vi.fn<Action>(() => new Promise((resolve) => (finish = resolve)));
    renderForm(action);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'アカウント削除' }));
    const pending = await screen.findByRole('button', { name: '削除中…' });

    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    await user.click(pending);
    expect(action).toHaveBeenCalledTimes(1);
    // 未完了のトランジションが後続のテストに絡まないよう完了させる。
    finish(failure());
    expect(await screen.findByRole('button', { name: 'アカウント削除' })).toBeEnabled();
  });

  it('Enterで送信できる', async () => {
    const action = vi.fn<Action>().mockResolvedValue(failure());
    renderForm(action);

    await userEvent.setup().type(screen.getByLabelText('パスワード'), 'password123{Enter}');

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
