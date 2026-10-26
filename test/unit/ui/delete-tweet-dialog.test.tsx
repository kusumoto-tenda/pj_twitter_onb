import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DeleteTweetFormState } from '@/app/tweets/delete-form-state';
import { TweetActionsMenu } from '@/app/ui/tweets/tweet-actions-menu';
import { TweetComposerProvider } from '@/app/ui/tweets/tweet-composer';
import { CaptureBoundary, captureUnhandledRejections, redirectError } from '../../support/next-control';

const TWEET = '00000000-0000-4000-8000-0000000000d1';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const TARGET = { tweetId: TWEET, actorId: ACTOR, content: '消す本文' };

type DeleteAction = (state: DeleteTweetFormState, formData: FormData) => Promise<DeleteTweetFormState | undefined>;
type BeginDelete = (tweetId: string) => Promise<{ ok: true; value: typeof TARGET } | { ok: false; message: string }>;

function setup({
  deleteAction = vi.fn<DeleteAction>().mockResolvedValue({ status: 'success', attempt: 1 }),
  beginDelete = vi.fn<BeginDelete>().mockResolvedValue({ ok: true, value: TARGET }),
  strict = false,
  onBoundaryError,
}: {
  deleteAction?: ReturnType<typeof vi.fn<DeleteAction>>;
  beginDelete?: ReturnType<typeof vi.fn<BeginDelete>>;
  strict?: boolean;
  onBoundaryError?: (error: unknown) => void;
} = {}) {
  const beginEdit = vi.fn();
  const tree = (
    <TweetComposerProvider
      beginDraft={vi.fn()}
      action={vi.fn()}
      beginEdit={beginEdit}
      updateAction={vi.fn()}
      beginDelete={beginDelete}
      deleteAction={deleteAction}
      uploader={{ upload: vi.fn(), discardUpload: vi.fn(async () => true), discardDraft: vi.fn() }}
    >
      <main>
        <h1>最新ツイート</h1>
        <TweetActionsMenu tweetId={TWEET} menuKey="tweet:a" />
      </main>
    </TweetComposerProvider>
  );
  const bounded = onBoundaryError ? <CaptureBoundary onError={onBoundaryError}>{tree}</CaptureBoundary> : tree;
  render(strict ? <StrictMode>{bounded}</StrictMode> : bounded);
  return { deleteAction, beginDelete, beginEdit, user: userEvent.setup() };
}

const dialog = () => screen.getByRole('dialog', { name: '本当に削除しますか？' });
const inDialog = () => within(dialog());
const menuButton = () => screen.getByRole('button', { name: 'ツイートの操作' });
const yes = () => inDialog().getByRole('button', { name: /はい|削除中…/ });
const no = () => inDialog().getByRole('button', { name: 'いいえ' });

async function open(ctx: ReturnType<typeof setup>) {
  await ctx.user.click(menuButton());
  await ctx.user.click(screen.getByRole('menuitem', { name: '削除する' }));
  await waitFor(() => expect(dialog()).toHaveAttribute('open'));
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('DeleteTweetDialog', () => {
  it('開く前にサーバーで確認し、確認文・取り消せない旨・「はい」「いいえ」を表示して「いいえ」にフォーカスする', async () => {
    const ctx = setup();
    await open(ctx);

    expect(ctx.beginDelete).toHaveBeenCalledWith(TWEET);
    expect(ctx.beginEdit).not.toHaveBeenCalled();
    expect(dialog()).toHaveAccessibleDescription(/投稿・添付画像・この投稿へのリツイートは元に戻せません/);
    expect(inDialog().getByText('消す本文')).toBeInTheDocument();
    expect(no()).toHaveFocus();
    expect(yes()).toHaveTextContent('はい');
    expect(ctx.deleteAction).not.toHaveBeenCalled();
  });

  it('開く準備に失敗したら理由を表示し、ダイアログを開かない', async () => {
    const ctx = setup({ beginDelete: vi.fn<BeginDelete>().mockResolvedValue({ ok: false, message: 'このツイートは削除できません' }) });
    await ctx.user.click(menuButton());
    await ctx.user.click(screen.getByRole('menuitem', { name: '削除する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('このツイートは削除できません');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('「いいえ」・Escでは送信せずに閉じ、メニューのボタンへフォーカスを戻す', async () => {
    const ctx = setup();
    await open(ctx);
    await ctx.user.click(no());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(menuButton()).toHaveFocus());

    await open(ctx);
    // jsdomはEscでcancelイベントを発火しないため、ブラウザと同じイベントを送る
    act(() => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ctx.deleteAction).not.toHaveBeenCalled();
  });

  it('Tab・Shift+Tabでフォーカスはダイアログ内を循環する', async () => {
    const ctx = setup();
    await open(ctx);

    await ctx.user.tab();
    expect(yes()).toHaveFocus();
    await ctx.user.tab();
    expect(no()).toHaveFocus();
    await ctx.user.tab({ shift: true });
    expect(yes()).toHaveFocus();
  });

  it('「はい」で投稿IDと準備時の利用者だけを送信する', async () => {
    const ctx = setup();
    await open(ctx);
    await ctx.user.click(yes());

    await waitFor(() => expect(ctx.deleteAction).toHaveBeenCalledTimes(1));
    const data = ctx.deleteAction.mock.calls[0][1];
    expect([...data.keys()].sort()).toEqual(['expectedActorId', 'tweetId']);
    expect(data.get('tweetId')).toBe(TWEET);
    expect(data.get('expectedActorId')).toBe(ACTOR);
  });

  it('削除中は「はい」「いいえ」・Escを受け付けない', async () => {
    const pending = deferred<DeleteTweetFormState>();
    const ctx = setup({ deleteAction: vi.fn<DeleteAction>().mockReturnValue(pending.promise) });
    await open(ctx);
    await ctx.user.click(yes());

    await waitFor(() => expect(yes()).toHaveTextContent('削除中…'));
    expect(yes()).toBeDisabled();
    expect(yes()).toHaveAttribute('aria-busy', 'true');
    expect(no()).toBeDisabled();
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog().dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog()).toHaveAttribute('open');

    await act(async () => pending.resolve({ status: 'success', attempt: 1 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('成功したら閉じて一度だけ「ツイートを削除しました」を通知し、一覧の見出しへフォーカスを移す', async () => {
    const ctx = setup({ strict: true });
    await open(ctx);
    await ctx.user.click(yes());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await screen.findAllByRole('status')).filter((s) => s.textContent === 'ツイートを削除しました')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('heading', { name: '最新ツイート' })).toHaveFocus());
  });

  it('既に削除されていたら、削除成功とは区別して通知して閉じる', async () => {
    const ctx = setup({
      deleteAction: vi.fn<DeleteAction>().mockResolvedValue({ status: 'not-found', message: 'このツイートは既に削除されています', attempt: 1 }),
    });
    await open(ctx);
    await ctx.user.click(yes());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('status')).toHaveTextContent('このツイートは既に削除されています');
    expect(screen.queryByText('ツイートを削除しました')).not.toBeInTheDocument();
  });

  it('失敗したら開いたまま理由と失敗通知を表示し、「はい」で再試行できる', async () => {
    const deleteAction = vi
      .fn<DeleteAction>()
      .mockResolvedValueOnce({
        status: 'error',
        code: 'UNAVAILABLE',
        message: 'ツイートを削除できませんでした。時間をおいて再度お試しください',
        attempt: 1,
      })
      .mockResolvedValueOnce({ status: 'success', attempt: 2 });
    const ctx = setup({ deleteAction });
    await open(ctx);
    await ctx.user.click(yes());

    expect(await screen.findByRole('alert')).toHaveTextContent('ツイートの削除に失敗しました');
    expect(inDialog().getByText('ツイートを削除できませんでした。時間をおいて再度お試しください')).toBeInTheDocument();
    expect(yes()).toBeEnabled();
    await ctx.user.click(yes());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deleteAction).toHaveBeenCalledTimes(2);
  });

  it('未ログインでログイン画面へ移動した場合（結果なし）は、削除成功として通知しない', async () => {
    const ctx = setup({ deleteAction: vi.fn<DeleteAction>().mockResolvedValue(undefined) });
    await open(ctx);
    await ctx.user.click(yes());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('ツイートを削除しました')).not.toBeInTheDocument();
  });

  it('StrictModeでもダイアログは1つだけ開く', async () => {
    const ctx = setup({ strict: true });
    await open(ctx);

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(no()).toHaveFocus();
  });

  it('削除の確認中は、メニュー（編集・別の削除）を開けない', async () => {
    const ctx = setup();
    await open(ctx);

    expect(screen.getByRole('button', { name: 'ツイートの操作', hidden: true })).toBeDisabled();
  });

  describe('Action自体のreject（通信の失敗など）', () => {
    const NETWORK_TOAST = '通信に失敗しました。もう一度お試しください';
    const UNCONFIRMED = '通信に失敗し、処理結果を確認できませんでした。入力を変更せず、もう一度お試しください';

    it('確認文・対象を保ったまま開いておき、「はい」「いいえ」を再び有効にする。成功・削除済みは通知しない', async () => {
      const deleteAction = vi.fn<DeleteAction>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup({ deleteAction });
      await open(ctx);

      await ctx.user.click(yes());

      expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
      expect(inDialog().getByText(UNCONFIRMED)).toBeInTheDocument();
      // 「削除されていない」とは断言しない
      expect(screen.queryByText(/削除されていません/)).not.toBeInTheDocument();
      expect(screen.queryByText('ツイートの削除に失敗しました')).not.toBeInTheDocument();
      expect(screen.queryByText('ツイートを削除しました')).not.toBeInTheDocument();
      expect(screen.queryByText('このツイートは既に削除されています')).not.toBeInTheDocument();
      expect(dialog()).toHaveAttribute('open');
      expect(inDialog().getByText('消す本文')).toBeInTheDocument();
      expect(yes()).toHaveTextContent('はい');
      expect(yes()).toBeEnabled();
      expect(no()).toBeEnabled();
      expect(ctx.beginDelete).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['削除成功', { status: 'success', attempt: 2 } as const, 'ツイートを削除しました'],
      ['既に削除済み（確定後に応答を失った場合を含む）', { status: 'not-found', message: 'このツイートは既に削除されています', attempt: 2 } as const, 'このツイートは既に削除されています'],
    ])('「はい」の再試行では同じ対象・利用者を送り、%sなら既存どおり閉じて通知する', async (_name, retried, message) => {
      const deleteAction = vi.fn<DeleteAction>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(retried);
      const ctx = setup({ deleteAction });
      await open(ctx);
      await ctx.user.click(yes());
      await inDialog().findByText(UNCONFIRMED);

      await ctx.user.click(yes());

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect((await screen.findAllByRole('status')).map((s) => s.textContent)).toEqual([message]);
      const [first, second] = deleteAction.mock.calls.map((call) => call[1]);
      expect(Array.from(second.entries())).toEqual(Array.from(first.entries()));
      expect(second.get('tweetId')).toBe(TWEET);
      expect(second.get('expectedActorId')).toBe(ACTOR);
      await waitFor(() => expect(screen.getByRole('heading', { name: '最新ツイート' })).toHaveFocus());
    });

    it('通信の失敗が続けば通知を出し直し、その後の通常エラーは既存の失敗通知と理由で開いたままにする', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const deleteAction = vi
          .fn<DeleteAction>()
          .mockRejectedValueOnce(new TypeError('Failed to fetch'))
          .mockRejectedValueOnce(new TypeError('Failed to fetch'))
          .mockResolvedValueOnce({
            status: 'error',
            code: 'SESSION_CHANGED',
            message: 'ログイン中の利用者が変わりました。画面を開き直してください',
            attempt: 3,
          });
        const ctx = setup({ deleteAction });
        await open(ctx);

        await ctx.user.click(yes());
        expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
        act(() => vi.advanceTimersByTime(3000));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await ctx.user.click(yes());
        expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);

        await ctx.user.click(yes());
        expect(await inDialog().findByText('ログイン中の利用者が変わりました。画面を開き直してください')).toBeInTheDocument();
        expect(inDialog().queryByText(UNCONFIRMED)).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('ツイートの削除に失敗しました');
        expect(dialog()).toHaveAttribute('open');
        expect(deleteAction).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('通信の失敗後に「いいえ」で閉じると、送信せずメニューへフォーカスを戻す', async () => {
      const deleteAction = vi.fn<DeleteAction>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup({ deleteAction });
      await open(ctx);
      await ctx.user.click(yes());
      await inDialog().findByText(UNCONFIRMED);

      await ctx.user.click(no());

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(deleteAction).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('ツイートを削除しました')).not.toBeInTheDocument();
      await waitFor(() => expect(menuButton()).toHaveFocus());
    });

    it('StrictModeでも1回の操作で1回だけ送信し、通信の失敗を表示する', async () => {
      const deleteAction = vi.fn<DeleteAction>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup({ deleteAction, strict: true });
      await open(ctx);

      await ctx.user.click(yes());

      expect(await inDialog().findByText(UNCONFIRMED)).toBeInTheDocument();
      expect(deleteAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('開く処理のreject・Next.jsの制御例外', () => {
    const NETWORK_TOAST = '通信に失敗しました。もう一度お試しください';
    const deleteItem = () => screen.getByRole('menuitem', { name: '削除する' });

    it('削除の準備がrejectしたら開かずに通信の案内を出し、再び開けば古い案内を消して開ける', async () => {
      const beginDelete = vi
        .fn<BeginDelete>()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue({ ok: true, value: TARGET });
      const ctx = setup({ beginDelete });

      await ctx.user.click(menuButton());
      await ctx.user.click(deleteItem());

      expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(menuButton()).toBeEnabled());

      await open(ctx);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(beginDelete).toHaveBeenCalledTimes(2);
    });

    it('削除の準備で投げられたredirectは変換せずに抜け、通信の案内も出さない', async () => {
      const control = redirectError('/login');
      const captured = captureUnhandledRejections();
      try {
        const ctx = setup({ beginDelete: vi.fn<BeginDelete>().mockRejectedValueOnce(control) });

        await ctx.user.click(menuButton());
        await ctx.user.click(deleteItem());

        await waitFor(() => expect(captured.errors).toEqual([control]));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      } finally {
        captured.restore();
      }
    });

    it('「はい」で投げられたredirectは変換せずにNext.jsへ渡し、通信の案内も削除の通知も出さない', async () => {
      const control = redirectError('/login');
      const onBoundaryError = vi.fn();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const ctx = setup({ deleteAction: vi.fn<DeleteAction>().mockRejectedValueOnce(control), onBoundaryError });
        await open(ctx);

        await ctx.user.click(yes());

        await waitFor(() => expect(onBoundaryError).toHaveBeenCalledWith(control));
        expect(screen.queryByText(NETWORK_TOAST)).not.toBeInTheDocument();
        expect(screen.queryByText('ツイートを削除しました')).not.toBeInTheDocument();
        expect(screen.queryByText('このツイートは既に削除されています')).not.toBeInTheDocument();
      } finally {
        consoleError.mockRestore();
      }
    });
  });
});
