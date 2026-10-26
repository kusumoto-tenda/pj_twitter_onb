import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreateTweetFormState } from '@/app/tweets/form-state';
import type { ImageUploader } from '@/app/ui/tweets/image-uploader';
import { CreateTweetLauncher } from '@/app/ui/tweets/create-tweet-launcher';
import { TweetComposerProvider } from '@/app/ui/tweets/tweet-composer';
import { CaptureBoundary, captureUnhandledRejections, redirectError } from '../../support/next-control';

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

function setup(
  action: Action = vi.fn(),
  { strict = false, onBoundaryError }: { strict?: boolean; onBoundaryError?: (error: unknown) => void } = {},
) {
  const uploader: ImageUploader = {
    upload: vi.fn(async () => ({ ok: true as const, uploadId: '00000000-0000-4000-8000-000000000001' })),
    discardUpload: vi.fn(async () => true),
    discardDraft: vi.fn(),
  };
  const beginDraft = vi.fn(async () => ({ ok: true as const, draftId: 'draft-1' }));
  const tree = (
    <TweetComposerProvider beginDraft={beginDraft} action={action} uploader={uploader}>
      <CreateTweetLauncher />
    </TweetComposerProvider>
  );
  const bounded = onBoundaryError ? <CaptureBoundary onError={onBoundaryError}>{tree}</CaptureBoundary> : tree;
  const view = render(strict ? <StrictMode>{bounded}</StrictMode> : bounded);
  return { uploader, beginDraft, action, user: userEvent.setup(), view };
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
  it('サーバー描画の時点では無効で、操作できるようになってから有効にする', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(
      <TweetComposerProvider beginDraft={vi.fn()} action={vi.fn()} uploader={{ upload: vi.fn(), discardUpload: vi.fn(async () => true), discardDraft: vi.fn() }}>
        <CreateTweetLauncher />
      </TweetComposerProvider>,
    );
    // class名の disabled: ではなく、disabled属性そのものを確認する。
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);

    setup();
    expect(launcher()).toBeEnabled();
  });

  it('開く前にサーバーで下書きを作り、ダイアログを開いて本文にフォーカスする', async () => {
    const ctx = setup();

    await open(ctx);

    expect(ctx.beginDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('本文')).toHaveFocus();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
    expect(screen.getByLabelText('画像を追加')).toBeInTheDocument();
  });

  it('準備の途中でボタンが作り直されても（画面の再取得など）、下書きが返ればダイアログを開く', async () => {
    let resolve: (r: { ok: true; draftId: string }) => void = () => {};
    const uploader = { upload: vi.fn(), discardUpload: vi.fn(async () => true), discardDraft: vi.fn() };
    const beginDraft = vi.fn(() => new Promise<{ ok: true; draftId: string }>((r) => (resolve = r)));
    const tree = (launcherKey: string) => (
      <TweetComposerProvider beginDraft={beginDraft} action={vi.fn()} uploader={uploader}>
        <CreateTweetLauncher key={launcherKey} />
      </TweetComposerProvider>
    );
    const view = render(tree('first'));
    await userEvent.setup().click(launcher());

    view.rerender(tree('remounted'));
    await act(async () => resolve({ ok: true, draftId: 'draft-1' }));

    await waitFor(() => expect(dialog()).toHaveAttribute('open'));
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
    await waitFor(() => expect(launcher()).toHaveFocus());
    await open(ctx);
    expect(screen.getByLabelText('本文')).toHaveValue('');
  });

  it('Tabはダイアログ内で循環し、外へ出ない（Shift+Tabも同様）', async () => {
    const ctx = setup();
    await open(ctx);
    const focusables = within(dialog())
      .getAllByRole('button')
      .concat(within(dialog()).getByLabelText('本文'));
    expect(focusables.length).toBeGreaterThan(1);
    const closeButton = within(dialog()).getByRole('button', { name: '閉じる' });
    const submit = submitButton();
    await ctx.user.type(screen.getByLabelText('本文'), 'a');

    submit.focus();
    await ctx.user.tab();
    expect(closeButton).toHaveFocus();
    await ctx.user.tab({ shift: true });
    expect(submit).toHaveFocus();
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

  it('画像の削除（予約の破棄）が終わるまでは投稿できない', async () => {
    const ctx = setup();
    await open(ctx);
    await ctx.user.upload(screen.getByLabelText('画像を追加'), new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    let finishRelease: (released: boolean) => void = () => {};
    vi.mocked(ctx.uploader.discardUpload).mockImplementationOnce(() => new Promise((r) => (finishRelease = r)));

    await ctx.user.click(within(dialog()).getByRole('button', { name: '画像1を削除' }));

    expect(submitButton()).toBeDisabled();
    await act(async () => finishRelease(true));
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  describe('Action自体のreject（通信の失敗など）', () => {
    const NETWORK_TOAST = '通信に失敗しました。もう一度お試しください';
    const UNCONFIRMED = '通信に失敗し、処理結果を確認できませんでした。入力を変更せず、もう一度お試しください';
    const UPLOAD_ID = '00000000-0000-4000-8000-000000000001';

    async function fillWithImage(ctx: ReturnType<typeof setup>) {
      await open(ctx);
      await ctx.user.type(screen.getByLabelText('本文'), '送れなかった本文');
      await ctx.user.upload(screen.getByLabelText('画像を追加'), new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
      await waitFor(() => expect(submitButton()).toBeEnabled());
    }

    const entries = (data: FormData) => Array.from(data.entries());

    it('ダイアログ・本文・下書き・準備済みの画像を保ち、通信の通知と結果不明の案内を出して、閉じる・送信を再び有効にする', async () => {
      const action = vi.fn<Action>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup(action);
      await fillWithImage(ctx);

      await ctx.user.click(submitButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
      expect(screen.queryByText('ツイートに失敗しました')).not.toBeInTheDocument();
      expect(within(dialog()).getByText(UNCONFIRMED)).toBeInTheDocument();
      expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
      expect(dialog()).toHaveAttribute('open');
      expect(screen.getByLabelText('本文')).toHaveValue('送れなかった本文');
      expect(screen.getByLabelText('本文')).not.toHaveAttribute('readonly');
      expect(within(dialog()).getAllByRole('img')).toHaveLength(1);
      expect(submitButton()).toBeEnabled();
      expect(within(dialog()).getByRole('button', { name: '閉じる' })).toBeEnabled();
      expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();
      expect(ctx.uploader.discardUpload).not.toHaveBeenCalled();
      expect(ctx.beginDraft).toHaveBeenCalledTimes(1);
    });

    it('利用者が押したときだけ、同じ本文・下書き・画像IDで再送する。成功すれば閉じ、下書きは破棄しない', async () => {
      const action = vi.fn<Action>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(undefined);
      const ctx = setup(action);
      await fillWithImage(ctx);
      await ctx.user.click(submitButton());
      await screen.findByText(UNCONFIRMED);
      expect(action).toHaveBeenCalledTimes(1);

      await ctx.user.click(submitButton());

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(action).toHaveBeenCalledTimes(2);
      expect(entries(action.mock.calls[1][1])).toEqual(entries(action.mock.calls[0][1]));
      expect(action.mock.calls[1][1].get('draftId')).toBe('draft-1');
      expect(action.mock.calls[1][1].getAll('uploadIds')).toEqual([UPLOAD_ID]);
      expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();
      expect(ctx.beginDraft).toHaveBeenCalledTimes(1);
    });

    it('通信の失敗が続いても、そのたびに3秒の通知を出し直す', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const action = vi
          .fn<Action>()
          .mockRejectedValueOnce(new TypeError('Failed to fetch'))
          .mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const ctx = setup(action);
        await open(ctx);
        await ctx.user.type(screen.getByLabelText('本文'), 'a');

        await ctx.user.click(submitButton());
        expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
        act(() => vi.advanceTimersByTime(3000));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await ctx.user.click(submitButton());
        expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
        expect(action).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('通常の欄エラーの後に通信が失敗したら、古い欄エラーを残さず、次の通常エラーは既存の通知に戻す', async () => {
      const action = vi
        .fn<Action>()
        .mockResolvedValueOnce(failure({ attempt: 1 }))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(failure({ attempt: 3 }));
      const ctx = setup(action);
      await open(ctx);
      await ctx.user.type(screen.getByLabelText('本文'), '長すぎる本文');
      await ctx.user.click(submitButton());
      expect(await screen.findByText('本文は280文字以下で入力してください')).toBeInTheDocument();

      await ctx.user.click(submitButton());

      expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
      expect(screen.queryByText('本文は280文字以下で入力してください')).not.toBeInTheDocument();
      expect(screen.getByLabelText('本文')).toHaveAttribute('aria-invalid', 'false');
      expect(screen.getByRole('alert')).toHaveTextContent(NETWORK_TOAST);

      await ctx.user.click(submitButton());

      expect(await screen.findByText('本文は280文字以下で入力してください')).toBeInTheDocument();
      expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('ツイートに失敗しました');
    });

    it('送信中は本文を変更できず（送信内容がずれない）、失敗後は再び編集できる', async () => {
      let reject: (error: unknown) => void = () => {};
      const action = vi.fn<Action>(() => new Promise((_resolve, r) => (reject = r)));
      const ctx = setup(action);
      await open(ctx);
      await ctx.user.type(screen.getByLabelText('本文'), '送信中');
      await ctx.user.click(submitButton());
      await findSubmit('投稿中…');

      expect(screen.getByLabelText('本文')).toHaveAttribute('readonly');
      await ctx.user.type(screen.getByLabelText('本文'), '追記');
      expect(screen.getByLabelText('本文')).toHaveValue('送信中');

      await act(async () => reject(new TypeError('Failed to fetch')));
      await screen.findByText(UNCONFIRMED);
      await ctx.user.type(screen.getByLabelText('本文'), '追記');
      expect(screen.getByLabelText('本文')).toHaveValue('送信中追記');
    });

    it('通信の失敗後も閉じる・Escでキャンセルでき、そのときだけ下書きを破棄する', async () => {
      const action = vi.fn<Action>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup(action);
      await open(ctx);
      await ctx.user.type(screen.getByLabelText('本文'), 'a');
      await ctx.user.click(submitButton());
      await screen.findByText(UNCONFIRMED);
      expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();

      await act(async () => {
        dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
      });

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(ctx.uploader.discardDraft).toHaveBeenCalledTimes(1);
      expect(ctx.uploader.discardDraft).toHaveBeenCalledWith('draft-1');
    });

    it('StrictModeでも1回の操作で1回だけ送信し、通信の失敗を表示する', async () => {
      const action = vi.fn<Action>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup(action, { strict: true });
      await open(ctx);
      await ctx.user.type(screen.getByLabelText('本文'), 'a');

      await ctx.user.click(submitButton());

      expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
      expect(action).toHaveBeenCalledTimes(1);
      expect(ctx.beginDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe('開く処理のreject・Next.jsの制御例外', () => {
    const NETWORK_TOAST = '通信に失敗しました。もう一度お試しください';

    it('下書きの準備がrejectしたら開かずに通信の案内を出し、再び押せば古い案内を消して開ける', async () => {
      const ctx = setup();
      ctx.beginDraft.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await ctx.user.click(launcher());

      expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
      expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(launcher()).toBeEnabled();
      expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();

      await open(ctx);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(ctx.beginDraft).toHaveBeenCalledTimes(2);
    });

    it('下書きの準備で投げられたredirectは変換せずに抜け、通信の案内も出さない', async () => {
      const control = redirectError('/login');
      const captured = captureUnhandledRejections();
      try {
        const ctx = setup();
        ctx.beginDraft.mockRejectedValueOnce(control as never);

        await ctx.user.click(launcher());

        await waitFor(() => expect(captured.errors).toEqual([control]));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => expect(launcher()).toBeEnabled());
      } finally {
        captured.restore();
      }
    });

    it.each(['/', '/login'])('送信で投げられたredirect(%s)は変換せずにNext.jsへ渡し、通信の案内も下書きの破棄も行わない', async (path) => {
      const control = redirectError(path);
      const onBoundaryError = vi.fn();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const action = vi.fn<Action>().mockRejectedValueOnce(control);
        const ctx = setup(action, { onBoundaryError });
        await open(ctx);
        await ctx.user.type(screen.getByLabelText('本文'), 'a');

        await ctx.user.click(submitButton());

        await waitFor(() => expect(onBoundaryError).toHaveBeenCalledWith(control));
        expect(screen.queryByText(NETWORK_TOAST)).not.toBeInTheDocument();
        expect(screen.queryByText(/処理結果を確認できませんでした/)).not.toBeInTheDocument();
        expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });
  });
});
