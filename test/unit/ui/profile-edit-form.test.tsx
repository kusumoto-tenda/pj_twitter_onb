import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProfileEditFormState } from '@/app/profile/[displayId]/edit/form-state';
import { ProfileEditForm } from '@/app/ui/profile/profile-edit-form';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type Action = (state: ProfileEditFormState, formData: FormData) => Promise<ProfileEditFormState>;

const initialValues = { name: 'アリス', displayId: 'Alice_1', bio: 'よろしく' };

function failure(overrides: Partial<Extract<ProfileEditFormState, { status: 'error' }>> = {}) {
  return {
    status: 'error',
    code: 'INVALID_INPUT',
    message: '',
    fieldErrors: {},
    values: initialValues,
    attempt: 1,
    ...overrides,
  } as ProfileEditFormState;
}

function renderForm(action: Action = vi.fn()) {
  render(<ProfileEditForm action={action} initialValues={initialValues} cancelHref="/profile/Alice_1" />);
}

describe('ProfileEditForm', () => {
  it('現在の名前・ID・自己紹介を初期表示し、キャンセルは編集前のプロフィールへのリンクにする', () => {
    renderForm();

    expect(screen.getByLabelText('名前')).toHaveValue('アリス');
    expect(screen.getByLabelText('ユーザーID')).toHaveValue('Alice_1');
    expect(screen.getByLabelText('自己紹介')).toHaveValue('よろしく');
    expect(screen.getByRole('link', { name: '編集をキャンセル' })).toHaveAttribute('href', '/profile/Alice_1');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.queryByLabelText(/パスワード/)).not.toBeInTheDocument();
  });

  it('自己紹介を空にして送信できる', async () => {
    const action = vi.fn<Action>().mockResolvedValue(failure());
    renderForm(action);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('自己紹介'));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(action.mock.calls[0][1])).toEqual({
      name: 'アリス',
      displayId: 'Alice_1',
      bio: '',
    });
  });

  it('Enterで送信できる', async () => {
    const action = vi.fn<Action>().mockResolvedValue(failure());
    renderForm(action);

    await userEvent.setup().type(screen.getByLabelText('名前'), '改{Enter}');

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0][1].get('name')).toBe('アリス改');
  });

  it('保存中は「保存中…」と表示してボタンを無効にし、二重送信しない', async () => {
    let finish: (state: ProfileEditFormState) => void = () => {};
    const action = vi.fn<Action>(() => new Promise((resolve) => (finish = resolve)));
    renderForm(action);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '保存' }));
    const pending = await screen.findByRole('button', { name: '保存中…' });

    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    await user.click(pending);
    expect(action).toHaveBeenCalledTimes(1);
    // 未完了のトランジションが後続のテストに絡まないよう完了させる。
    finish(failure());
    expect(await screen.findByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('入力違反は欄ごとに表示し、送信した入力値を保持する', async () => {
    const action = vi.fn<Action>().mockResolvedValue(
      failure({
        fieldErrors: { name: ['名前を入力してください'], displayId: ['このユーザーIDは既に使われています'] },
        values: { name: '', displayId: 'Bob_12', bio: '変更後' },
      }),
    );
    renderForm(action);

    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(screen.getByLabelText('ユーザーID')).toHaveAttribute('aria-invalid', 'true'),
    );
    const idInput = screen.getByLabelText('ユーザーID');
    expect(document.getElementById(idInput.getAttribute('aria-describedby')!)).toHaveTextContent(
      'このユーザーIDは既に使われています',
    );
    expect(screen.getByLabelText('名前')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('ユーザーID')).toHaveValue('Bob_12');
    expect(screen.getByLabelText('自己紹介')).toHaveValue('変更後');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('DB障害などはフォーム全体のメッセージとして表示し、入力値を保持する', async () => {
    const action = vi.fn<Action>().mockResolvedValue(
      failure({
        code: 'UNAVAILABLE',
        message: '保存できませんでした。時間をおいて再度お試しください',
        values: { name: '変更後', displayId: 'Alice_1', bio: '' },
      }),
    );
    renderForm(action);

    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした');
    expect(screen.getByLabelText('名前')).toHaveValue('変更後');
  });
});
