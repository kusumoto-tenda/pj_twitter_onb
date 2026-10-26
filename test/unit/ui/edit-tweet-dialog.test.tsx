import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EditableTweet } from '@/application/tweets/ports/tweet-editor';
import type { EditTweetFormState } from '@/app/tweets/edit-form-state';
import type { ImageUploader } from '@/app/ui/tweets/image-uploader';
import { TweetActionsMenu } from '@/app/ui/tweets/tweet-actions-menu';
import { TweetComposerProvider } from '@/app/ui/tweets/tweet-composer';

const TWEET = '00000000-0000-4000-8000-0000000000d1';
const img = (n: number) => ({ id: `00000000-0000-4000-9000-00000000000${n}`, position: n - 1, width: 10 * n, height: 10 });
const EDITABLE: EditableTweet = { draftId: 'edit-draft-1', tweetId: TWEET, content: '元の本文', images: [img(1), img(2), img(3)] };

type UpdateAction = (state: EditTweetFormState, formData: FormData) => Promise<EditTweetFormState | undefined>;

function failure(overrides: Partial<Extract<EditTweetFormState, { status: 'error' }>> = {}): EditTweetFormState {
  return { status: 'error', code: 'INVALID_INPUT', message: '', fieldErrors: {}, attempt: 1, ...overrides };
}

function setup({
  updateAction = vi.fn<UpdateAction>().mockResolvedValue({ status: 'success', tweetId: TWEET, attempt: 1 }),
  value = EDITABLE,
  strict = false,
}: { updateAction?: ReturnType<typeof vi.fn<UpdateAction>>; value?: EditableTweet; strict?: boolean } = {}) {
  let seq = 0;
  const uploader: ImageUploader = {
    upload: vi.fn(async () => ({ ok: true as const, uploadId: `00000000-0000-4000-8000-00000000010${++seq}` })),
    discardUpload: vi.fn(async () => true),
    discardDraft: vi.fn(),
  };
  const beginEdit = vi.fn(async () => ({ ok: true as const, value }));
  const tree = (
    <TweetComposerProvider beginDraft={vi.fn()} action={vi.fn()} beginEdit={beginEdit} updateAction={updateAction} uploader={uploader}>
      <TweetActionsMenu tweetId={TWEET} menuKey="tweet:a" />
    </TweetComposerProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { uploader, beginEdit, updateAction, user: userEvent.setup() };
}

const dialog = () => screen.getByRole('dialog', { name: 'ツイートを編集' });
const inDialog = () => within(dialog());
const menuButton = () => screen.getByRole('button', { name: 'ツイートの操作' });

async function open(ctx: ReturnType<typeof setup>) {
  await ctx.user.click(menuButton());
  await ctx.user.click(screen.getByRole('menuitem', { name: '編集する' }));
  await waitFor(() => expect(dialog()).toHaveAttribute('open'));
}

async function addImages(ctx: ReturnType<typeof setup>, count: number) {
  const files = Array.from({ length: count }, (_, i) => new File([new Uint8Array(4)], `n${i}.png`, { type: 'image/png' }));
  await ctx.user.upload(inDialog().getByLabelText('画像を追加'), files);
  await waitFor(() => expect(inDialog().queryByText('アップロード中')).not.toBeInTheDocument());
}

describe('EditTweetDialog', () => {
  it('DBの現在の本文・画像を初期値にし、本文にフォーカスする', async () => {
    const ctx = setup();
    await open(ctx);

    expect(inDialog().getByLabelText('本文')).toHaveValue('元の本文');
    expect(inDialog().getByLabelText('本文')).toHaveFocus();
    expect(inDialog().getAllByRole('img').map((i) => i.getAttribute('src'))).toEqual(EDITABLE.images.map((i) => `/media/${i.id}`));
    expect(inDialog().getByRole('button', { name: '更新' })).toBeEnabled();
  });

  it('既存画像の解除はフォーム内だけの変更で、解除した分だけ新規画像の枠が空く（合計4枚）', async () => {
    const ctx = setup();
    await open(ctx);
    // 既存3枚なら新規は1枚まで
    await addImages(ctx, 1);
    expect(inDialog().getByLabelText('画像を追加')).toBeDisabled();

    await ctx.user.click(inDialog().getByRole('button', { name: '添付済みの画像1を解除' }));
    expect(ctx.uploader.discardUpload).not.toHaveBeenCalled();
    expect(inDialog().getByLabelText('画像を追加')).toBeEnabled();
    await addImages(ctx, 1);
    expect(inDialog().getByLabelText('画像を追加')).toBeDisabled();
  });

  it('本文・保持する既存画像（元の順）・新規画像（選択順）だけを送信する', async () => {
    const ctx = setup();
    await open(ctx);
    await ctx.user.clear(inDialog().getByLabelText('本文'));
    await ctx.user.type(inDialog().getByLabelText('本文'), '新しい本文');
    await ctx.user.click(inDialog().getByRole('button', { name: '添付済みの画像2を解除' }));
    await addImages(ctx, 2);

    await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

    await waitFor(() => expect(ctx.updateAction).toHaveBeenCalledTimes(1));
    const data = ctx.updateAction.mock.calls[0][1];
    expect(data.get('draftId')).toBe('edit-draft-1');
    expect(data.get('content')).toBe('新しい本文');
    expect(data.getAll('keepImageIds')).toEqual([img(1).id, img(3).id]);
    expect(data.getAll('uploadIds')).toEqual(['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102']);
  });

  it('成功したらダイアログを閉じて「ツイートを更新しました」を出し、メニューのボタンにフォーカスを戻す', async () => {
    const ctx = setup();
    await open(ctx);

    await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('status')).toHaveTextContent('ツイートを更新しました');
    expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(menuButton()).toHaveFocus());
  });

  it('失敗したらダイアログと入力を保ち、欄エラー・全体の案内・失敗の通知を出す', async () => {
    const updateAction = vi
      .fn<UpdateAction>()
      .mockResolvedValueOnce(failure({ fieldErrors: { content: ['本文は280文字以下で入力してください'] } }))
      .mockResolvedValueOnce(failure({ code: 'CONFLICT', message: '他の画面で更新されています。閉じて開き直してください', attempt: 2 }));
    const ctx = setup({ updateAction });
    await open(ctx);
    await ctx.user.type(inDialog().getByLabelText('本文'), '追記');

    await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
    expect(await inDialog().findByRole('alert')).toHaveTextContent('ツイートの更新に失敗しました');
    expect(inDialog().getByText('本文は280文字以下で入力してください')).toBeInTheDocument();
    expect(inDialog().getByLabelText('本文')).toHaveValue('元の本文追記');

    await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
    expect(await inDialog().findByText('他の画面で更新されています。閉じて開き直してください')).toBeInTheDocument();
    expect(inDialog().getByLabelText('本文')).toHaveValue('元の本文追記');
  });

  it('保存中は本文・添付・閉じる・Esc・更新ボタンを操作できない', async () => {
    let finish: (s: EditTweetFormState) => void = () => {};
    const updateAction = vi.fn<UpdateAction>(() => new Promise((resolve) => (finish = resolve)));
    const ctx = setup({ updateAction });
    await open(ctx);

    await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
    const pending = await inDialog().findByRole('button', { name: '更新中…' });
    expect(pending).toBeDisabled();
    expect(inDialog().getByRole('button', { name: '閉じる' })).toBeDisabled();
    expect(inDialog().getByLabelText('本文')).toHaveAttribute('readonly');
    expect(inDialog().getByLabelText('画像を追加')).toBeDisabled();
    expect(inDialog().getByRole('button', { name: '添付済みの画像1を解除' })).toBeDisabled();
    const cancel = new Event('cancel', { cancelable: true });
    await act(async () => {
      dialog().dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    await ctx.user.click(pending);
    expect(updateAction).toHaveBeenCalledTimes(1);

    finish(failure());
    expect(await inDialog().findByRole('button', { name: '更新' })).toBeEnabled();
  });

  it('閉じる・Escは保存せず、編集用の下書き（新規画像だけ）の破棄を通知し、メニューのボタンにフォーカスを戻す', async () => {
    const ctx = setup();
    await open(ctx);
    await ctx.user.click(inDialog().getByRole('button', { name: '閉じる' }));

    expect(ctx.updateAction).not.toHaveBeenCalled();
    expect(ctx.uploader.discardDraft).toHaveBeenCalledWith('edit-draft-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(menuButton()).toHaveFocus());

    await open(ctx);
    await act(async () => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('作成と編集は同時に1つだけ開く', async () => {
    const ctx = setup();
    await open(ctx);

    await ctx.user.click(menuButton());
    expect(screen.queryByRole('menuitem', { name: '編集する' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('StrictModeでも開いて編集し、成功できる', async () => {
    const ctx = setup({ strict: true });
    await open(ctx);
    await ctx.user.type(inDialog().getByLabelText('本文'), '！');
    await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('開けなかったら理由を表示し、ダイアログを開かない', async () => {
    const ctx = setup();
    ctx.beginEdit.mockResolvedValueOnce({ ok: false, message: 'このツイートは編集できません' } as never);

    await ctx.user.click(menuButton());
    await ctx.user.click(screen.getByRole('menuitem', { name: '編集する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('このツイートは編集できません');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('新規画像の削除（予約の破棄）が終わるまでは更新できず、削除した画像を送信しない', async () => {
    const ctx = setup();
    await open(ctx);
    await addImages(ctx, 1);
    let finishRelease: (released: boolean) => void = () => {};
    vi.mocked(ctx.uploader.discardUpload).mockImplementationOnce(() => new Promise((r) => (finishRelease = r)));

    await ctx.user.click(inDialog().getByRole('button', { name: '画像1を削除' }));
    expect(inDialog().getByRole('button', { name: '更新' })).toBeDisabled();
    await act(async () => finishRelease(true));
    await waitFor(() => expect(inDialog().getByRole('button', { name: '更新' })).toBeEnabled());
    await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

    await waitFor(() => expect(ctx.updateAction).toHaveBeenCalledTimes(1));
    expect(ctx.updateAction.mock.calls[0][1].getAll('uploadIds')).toEqual([]);
  });

  describe('Action自体のreject（通信の失敗など）', () => {
    const NETWORK_TOAST = '通信に失敗しました。もう一度お試しください';
    const UNCONFIRMED = '通信に失敗し、処理結果を確認できませんでした。入力を変更せず、もう一度お試しください';
    const entries = (data: FormData) => Array.from(data.entries());

    /** 本文の変更・既存画像の解除・新規画像の追加をした状態にする。 */
    async function editEverything(ctx: ReturnType<typeof setup>) {
      await open(ctx);
      await ctx.user.clear(inDialog().getByLabelText('本文'));
      await ctx.user.type(inDialog().getByLabelText('本文'), '編集した本文');
      await ctx.user.click(inDialog().getByRole('button', { name: '添付済みの画像2を解除' }));
      await addImages(ctx, 1);
    }

    it('本文・保持する既存画像・新規画像・下書きを保ち、閉じずに通信の通知と結果不明の案内を出す', async () => {
      const updateAction = vi.fn<UpdateAction>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup({ updateAction });
      await editEverything(ctx);

      await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

      expect(await inDialog().findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
      expect(inDialog().getByText(UNCONFIRMED)).toBeInTheDocument();
      expect(screen.queryByText('ツイートの更新に失敗しました')).not.toBeInTheDocument();
      expect(screen.queryByText('ツイートを更新しました')).not.toBeInTheDocument();
      expect(dialog()).toHaveAttribute('open');
      expect(inDialog().getByLabelText('本文')).toHaveValue('編集した本文');
      const kept = inDialog().getAllByRole('img').map((i) => i.getAttribute('src')).filter((src) => src?.startsWith('/media/'));
      expect(kept).toEqual([`/media/${img(1).id}`, `/media/${img(3).id}`]);
      expect(inDialog().getByRole('button', { name: '添付済みの画像1を解除' })).toBeEnabled();
      expect(inDialog().getByRole('button', { name: '画像1を削除' })).toBeEnabled();
      expect(inDialog().getByRole('button', { name: '更新' })).toBeEnabled();
      expect(inDialog().getByRole('button', { name: '閉じる' })).toBeEnabled();
      expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();
      expect(ctx.uploader.discardUpload).not.toHaveBeenCalled();
      expect(ctx.beginEdit).toHaveBeenCalledTimes(1);
    });

    it('再試行では同じ下書き・本文・画像IDを送り、成功したときだけ閉じて更新を通知する', async () => {
      const updateAction = vi
        .fn<UpdateAction>()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ status: 'success', tweetId: TWEET, attempt: 2 });
      const ctx = setup({ updateAction });
      await editEverything(ctx);
      await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
      await inDialog().findByText(UNCONFIRMED);

      await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByRole('status')).toHaveTextContent('ツイートを更新しました');
      const [first, second] = updateAction.mock.calls.map((call) => call[1]);
      expect(entries(second)).toEqual(entries(first));
      expect(second.get('draftId')).toBe('edit-draft-1');
      expect(second.get('content')).toBe('編集した本文');
      expect(second.getAll('keepImageIds')).toEqual([img(1).id, img(3).id]);
      expect(second.getAll('uploadIds')).toEqual(['00000000-0000-4000-8000-000000000101']);
      expect(ctx.uploader.discardDraft).not.toHaveBeenCalled();
      expect(ctx.beginEdit).toHaveBeenCalledTimes(1);
    });

    it('通信の失敗が続けば通知を出し直し、その後の競合などの通常エラーは既存の説明で表示する', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const updateAction = vi
          .fn<UpdateAction>()
          .mockRejectedValueOnce(new TypeError('Failed to fetch'))
          .mockRejectedValueOnce(new TypeError('Failed to fetch'))
          .mockResolvedValueOnce(failure({ code: 'CONFLICT', message: '他の画面で更新されています。閉じて開き直してください', attempt: 3 }));
        const ctx = setup({ updateAction });
        await open(ctx);

        await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
        expect(await inDialog().findByRole('alert')).toHaveTextContent(NETWORK_TOAST);
        act(() => vi.advanceTimersByTime(3000));
        expect(inDialog().queryByRole('alert')).not.toBeInTheDocument();

        await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
        expect(await inDialog().findByRole('alert')).toHaveTextContent(NETWORK_TOAST);

        await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
        expect(await inDialog().findByText('他の画面で更新されています。閉じて開き直してください')).toBeInTheDocument();
        expect(inDialog().queryByText(UNCONFIRMED)).not.toBeInTheDocument();
        expect(inDialog().getByRole('alert')).toHaveTextContent('ツイートの更新に失敗しました');
        expect(dialog()).toHaveAttribute('open');
        expect(updateAction).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('通常の欄エラーの後に通信が失敗したら、古い欄エラーを残さない', async () => {
      const updateAction = vi
        .fn<UpdateAction>()
        .mockResolvedValueOnce(failure({ fieldErrors: { content: ['本文は280文字以下で入力してください'] } }))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup({ updateAction });
      await open(ctx);
      await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
      expect(await inDialog().findByText('本文は280文字以下で入力してください')).toBeInTheDocument();

      await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

      expect(await inDialog().findByText(UNCONFIRMED)).toBeInTheDocument();
      expect(inDialog().queryByText('本文は280文字以下で入力してください')).not.toBeInTheDocument();
      expect(inDialog().getByLabelText('本文')).toHaveAttribute('aria-invalid', 'false');
    });

    it('通信の失敗後に閉じたら、そのときだけ編集用の下書きを破棄し、更新は通知しない', async () => {
      const updateAction = vi.fn<UpdateAction>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup({ updateAction });
      await open(ctx);
      await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));
      await inDialog().findByText(UNCONFIRMED);

      await ctx.user.click(inDialog().getByRole('button', { name: '閉じる' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(ctx.uploader.discardDraft).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('ツイートを更新しました')).not.toBeInTheDocument();
      await waitFor(() => expect(menuButton()).toHaveFocus());
    });

    it('StrictModeでも1回の操作で1回だけ送信し、通信の失敗を表示する', async () => {
      const updateAction = vi.fn<UpdateAction>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const ctx = setup({ updateAction, strict: true });
      await open(ctx);

      await ctx.user.click(inDialog().getByRole('button', { name: '更新' }));

      expect(await inDialog().findByText(UNCONFIRMED)).toBeInTheDocument();
      expect(updateAction).toHaveBeenCalledTimes(1);
    });
  });
});
