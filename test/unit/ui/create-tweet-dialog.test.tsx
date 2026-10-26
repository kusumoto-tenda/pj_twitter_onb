import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreateTweetFormState } from '@/app/tweets/form-state';
import type { ImageUploader } from '@/app/ui/tweets/image-uploader';
import { CreateTweetLauncher } from '@/app/ui/tweets/create-tweet-launcher';

type Action = (state: CreateTweetFormState, formData: FormData) => Promise<CreateTweetFormState | undefined>;

function failure(overrides: Partial<Extract<CreateTweetFormState, { status: 'error' }>> = {}) {
  return {
    status: 'error',
    code: 'INVALID_INPUT',
    message: '',
    fieldErrors: { content: ['本文は280文字以下で入力してください'] },
    attempt: 1,
    ...overrides,
  } as CreateTweetFormState;
}

function setup(action: Action = vi.fn()) {
  const uploader: ImageUploader = {
    upload: vi.fn(async () => ({ ok: true as const, uploadId: '00000000-0000-4000-8000-000000000001' })),
    discardUpload: vi.fn(),
    discardDraft: vi.fn(),
  };
  const beginDraft = vi.fn(async () => ({ ok: true as const, draftId: 'draft-1' }));
  render(<CreateTweetLauncher beginDraft={beginDraft} action={action} uploader={uploader} />);
  return { uploader, beginDraft, action, user: userEvent.setup() };
}

// jsdomではモーダルの外も操作対象に残るため、起動ボタンはダイアログの外、投稿ボタンはダイアログ内で探す。
const launcher = () => screen.getAllByRole('button', { name: 'ツイートする' })[0];
const dialog = () => screen.getByRole('dialog', { name: 'ツイートを作成' });
const submitButton = (name: string | RegExp = 'ツイートする') => within(dialog()).getByRole('button', { name });
const findSubmit = (name: string) => within(dialog()).findByRole('button', { name });

async function open(ctx: ReturnType<typeof setup>) {
  await ctx.user.click(launcher());
  await waitFor(() => expect(dialog()).toHaveAttribute('open'));
}

describe('CreateTweetLauncher / CreateTweetDialog', () => {
  it('開く前にサーバーで下書きを作り、ダイアログを開いて本文にフォーカスする', async () => {
    const ctx = setup();

    await open(ctx);

    expect(ctx.beginDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('本文')).toHaveFocus();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
    expect(screen.getByLabelText('画像を追加')).toBeInTheDocument();
  });

  it('下書きを作れなければ開かず、理由を表示する', async () => {
    const ctx = setup();
    ctx.beginDraft.mockResolvedValueOnce({ ok: false, message: 'ツイートの準備ができませんでした' } as never);

    await ctx.user.click(launcher());

    expect(await screen.findByRole('alert')).toHaveTextContent('ツイートの準備ができませんでした');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('文字数をコードポイントで表示し、Enterは改行にして送信しない', async () => {
    const ctx = setup();
    await open(ctx);

    await ctx.user.type(screen.getByLabelText('本文'), '😀あ{Enter}い');

    expect(screen.getByLabelText('本文')).toHaveValue('😀あ\nい');
    expect(screen.getByText('4 / 280')).toBeInTheDocument();
    expect(ctx.action).not.toHaveBeenCalled();
  });

  it('日本語変換の確定（compositionend）では送信しない', async () => {
    const ctx = setup();
    await open(ctx);
    const textarea = screen.getByLabelText('本文');

    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '変換' }));
    });

    expect(ctx.action).not.toHaveBeenCalled();
  });

  it('本文・下書きID・準備できた画像IDだけを送信する', async () => {
    const action = vi.fn<Action>().mockResolvedValue(failure());
    const ctx = setup(action);
    await open(ctx);
    await ctx.user.type(screen.getByLabelText('本文'), 'こんにちは');
    await ctx.user.upload(screen.getByLabelText('画像を追加'), new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.queryByText('アップロード中')).not.toBeInTheDocument());

    await ctx.user.click(submitButton());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = action.mock.calls[0][1];
    expect(data.get('draftId')).toBe('draft-1');
    expect(data.get('content')).toBe('こんにちは');
    expect(data.getAll('uploadIds')).toEqual(['00000000-0000-4000-8000-000000000001']);
  });

  it('閉じるとサーバーに下書きの破棄を通知し、閉じて起動ボタンにフォーカスを戻す。開き直すと空になる', async () => {
    const ctx = setup();
    await open(ctx);
    await ctx.user.type(screen.getByLabelText('本文'), '捨てる本文');

    await ctx.user.click(screen.getByRole('button', { name: '閉じる' }));

    expect(ctx.uploader.discardDraft).toHaveBeenCalledWith('draft-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(launcher()).toHaveFocus();
    await open(ctx);
    expect(screen.getByLabelText('本文')).toHaveValue('');
  });

  it('Escキー（cancelイベント）でも同じようにキャンセルする', async () => {
    const ctx = setup();
    await open(ctx);

    await act(async () => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    });

    expect(ctx.uploader.discardDraft).toHaveBeenCalledWith('draft-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('投稿の確定中は閉じる・Esc・二重送信を受け付けない', async () => {
    let finish: (s: CreateTweetFormState) => void = () => {};
    const action = vi.fn<Action>(() => new Promise((resolve) => (finish = resolve)));
    const ctx = setup(action);
    await open(ctx);
    await ctx.user.type(screen.getByLabelText('本文'), 'a');
    await ctx.user.click(submitButton());

    const posting = await findSubmit('投稿中…');
    expect(posting).toBeDisabled();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeDisabled();
    const cancel = new Event('cancel', { cancelable: true });
    await act(async () => {
      dialog().dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    await ctx.user.click(posting);
    expect(action).toHaveBeenCalledTimes(1);
    expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();

    finish(failure());
    expect(await findSubmit('ツイートする')).toBeEnabled();
  });

  it('失敗時はダイアログと本文を保ち、欄エラーと失敗の通知を出す。同じエラーでも通知を再表示する', async () => {
    const action = vi
      .fn<Action>()
      .mockResolvedValueOnce(failure({ attempt: 1 }))
      .mockResolvedValueOnce(failure({ attempt: 2 }));
    const ctx = setup(action);
    await open(ctx);
    await ctx.user.type(screen.getByLabelText('本文'), '長すぎる本文');

    await ctx.user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('ツイートに失敗しました');
    expect(screen.getByLabelText('本文')).toHaveValue('長すぎる本文');
    expect(screen.getByLabelText('本文')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('本文は280文字以下で入力してください')).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('open');

    await ctx.user.click(submitButton());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('ツイートに失敗しました');
  });

  it('全体のエラー（別アカウントへの切り替えなど）はメッセージとして表示する', async () => {
    const action = vi.fn<Action>().mockResolvedValue(
      failure({ code: 'FORBIDDEN', message: 'この下書きからは投稿できません。閉じて開き直してください', fieldErrors: {} }),
    );
    const ctx = setup(action);
    await open(ctx);
    await ctx.user.type(screen.getByLabelText('本文'), 'a');

    await ctx.user.click(submitButton());

    expect(await screen.findByText('この下書きからは投稿できません。閉じて開き直してください')).toBeInTheDocument();
  });

  it('成功（サーバーがメイン画面へ移動）したらダイアログを閉じ、下書きの破棄は通知しない', async () => {
    const action = vi.fn<Action>().mockResolvedValue(undefined);
    const ctx = setup(action);
    await open(ctx);
    await ctx.user.type(screen.getByLabelText('本文'), 'a');

    await ctx.user.click(submitButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();
  });

  it('画像のアップロード中は投稿できない', async () => {
    const ctx = setup();
    vi.mocked(ctx.uploader.upload).mockImplementation(() => new Promise(() => {}));
    await open(ctx);

    await ctx.user.upload(screen.getByLabelText('画像を追加'), new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));

    expect(submitButton()).toBeDisabled();
  });
});
