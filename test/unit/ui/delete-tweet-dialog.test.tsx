import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DeleteTweetFormState } from '@/app/tweets/delete-form-state';
import { TweetActionsMenu } from '@/app/ui/tweets/tweet-actions-menu';
import { TweetComposerProvider } from '@/app/ui/tweets/tweet-composer';

const TWEET = '00000000-0000-4000-8000-0000000000d1';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const TARGET = { tweetId: TWEET, actorId: ACTOR, content: '消す本文' };

type DeleteAction = (state: DeleteTweetFormState, formData: FormData) => Promise<DeleteTweetFormState | undefined>;
type BeginDelete = (tweetId: string) => Promise<{ ok: true; value: typeof TARGET } | { ok: false; message: string }>;

function setup({
  deleteAction = vi.fn<DeleteAction>().mockResolvedValue({ status: 'success', attempt: 1 }),
  beginDelete = vi.fn<BeginDelete>().mockResolvedValue({ ok: true, value: TARGET }),
  strict = false,
}: {
  deleteAction?: ReturnType<typeof vi.fn<DeleteAction>>;
  beginDelete?: ReturnType<typeof vi.fn<BeginDelete>>;
  strict?: boolean;
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
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
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
});
