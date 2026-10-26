import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImageUploader, UploadResult } from '@/app/ui/tweets/image-uploader';
import { TweetImagePicker } from '@/app/ui/tweets/tweet-image-picker';

const png = (name = 'a.png', size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' });

/** 各アップロードを外から完了・失敗させられる偽のアップローダー。 */
function controllableUploader() {
  const pending: { resolve: (r: UploadResult) => void; signal: AbortSignal; stage: (s: 'uploading' | 'verifying') => void }[] = [];
  let seq = 0;
  const uploader: ImageUploader = {
    upload: vi.fn(
      ({ signal, onStage }) =>
        new Promise<UploadResult>((resolve) => pending.push({ resolve, signal, stage: onStage })),
    ),
    discardUpload: vi.fn(),
    discardDraft: vi.fn(),
  };
  const succeed = async (index: number) => {
    await act(async () => {
      pending[index].stage('verifying');
      pending[index].resolve({ ok: true, uploadId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` });
    });
  };
  const fail = async (index: number, message = '画像をアップロードできませんでした。再試行してください') => {
    await act(async () => pending[index].resolve({ ok: false, message }));
  };
  return { uploader, pending, succeed, fail };
}

function renderPicker(uploader: ImageUploader, onChange = vi.fn()) {
  const view = render(<TweetImagePicker draftId="draft-1" uploader={uploader} disabled={false} onChange={onChange} />);
  return { ...view, onChange };
}

describe('TweetImagePicker', () => {
  it('選んだ画像をプレビューし、アップロード中・確認中・完了の状態を表示して、準備できたIDを選択順で通知する', async () => {
    const { uploader, succeed } = controllableUploader();
    const { onChange } = renderPicker(uploader);

    await userEvent.setup().upload(screen.getByLabelText('画像を追加'), [png('1.png'), png('2.png')]);

    expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual(['添付画像1', '添付画像2']);
    expect(screen.getAllByText('アップロード中')).toHaveLength(2);
    await succeed(1);
    await succeed(0);
    expect(screen.queryByText('アップロード中')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({
      uploadIds: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'],
      busy: false,
    });
  });

  it('複数回の選択を合算して4枚までにし、上限に達したら選択を無効にする', async () => {
    const { uploader } = controllableUploader();
    renderPicker(uploader);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText('画像を追加'), [png('1.png'), png('2.png'), png('3.png')]);
    await user.upload(screen.getByLabelText('画像を追加'), [png('4.png'), png('5.png')]);

    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(uploader.upload).toHaveBeenCalledTimes(4);
    expect(screen.getByLabelText('画像を追加')).toBeDisabled();
    expect(screen.getByText('画像は4枚まで添付できます')).toBeInTheDocument();
  });

  it('JPEG・PNG以外と5MB超過はアップロードせずにエラーを表示する（上限ちょうどは受け付ける）', async () => {
    const { uploader } = controllableUploader();
    renderPicker(uploader);
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(screen.getByLabelText('画像を追加'), new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(screen.getByText('JPEG・PNG画像のみ添付できます')).toBeInTheDocument();
    await user.upload(screen.getByLabelText('画像を追加'), png('big.png', 5 * 1024 * 1024 + 1));
    expect(screen.getByText('画像は1枚5MB以下にしてください')).toBeInTheDocument();
    expect(uploader.upload).not.toHaveBeenCalled();

    await user.upload(screen.getByLabelText('画像を追加'), png('exact.png', 5 * 1024 * 1024));
    expect(uploader.upload).toHaveBeenCalledTimes(1);
  });

  it('解除すると、アップロード中なら中断し、完了済みならサーバーに破棄を通知して、プレビューURLを解放する', async () => {
    const { uploader, pending, succeed } = controllableUploader();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { onChange } = renderPicker(uploader);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('画像を追加'), [png('1.png'), png('2.png')]);
    await succeed(0);

    await user.click(screen.getByRole('button', { name: '画像2を削除' }));
    expect(pending[1].signal.aborted).toBe(true);
    await user.click(screen.getByRole('button', { name: '画像1を削除' }));

    expect(uploader.discardUpload).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(onChange).toHaveBeenLastCalledWith({ uploadIds: [], busy: false });
  });

  it('失敗した画像を特定して表示し、再試行で新しくアップロードし直せる', async () => {
    const { uploader, fail, succeed } = controllableUploader();
    const { onChange } = renderPicker(uploader);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('画像を追加'), [png('1.png')]);

    await fail(0, 'JPEG・PNG画像のみ添付できます');
    expect(screen.getByText('JPEG・PNG画像のみ添付できます')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ uploadIds: [], busy: true });
    await user.click(screen.getByRole('button', { name: '画像1を再試行' }));
    await succeed(1);

    expect(uploader.upload).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ uploadIds: ['00000000-0000-4000-8000-000000000001'], busy: false });
  });

  it('アンマウント時にアップロードを中断し、プレビューURLを解放する', async () => {
    const { uploader, pending } = controllableUploader();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { unmount } = renderPicker(uploader);
    await userEvent.setup().upload(screen.getByLabelText('画像を追加'), [png('1.png')]);
    revoke.mockClear();

    unmount();

    await waitFor(() => expect(pending[0].signal.aborted).toBe(true));
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('アップロード中に解除した画像も、後から分かった予約を破棄する（予約枠を残さない）', async () => {
    const { uploader, pending } = controllableUploader();
    renderPicker(uploader);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('画像を追加'), [png('1.png')]);

    await user.click(screen.getByRole('button', { name: '画像1を削除' }));
    await act(async () =>
      pending[0].resolve({ ok: false, uploadId: '00000000-0000-4000-8000-0000000000aa', message: '中断しました' }),
    );

    expect(uploader.discardUpload).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000aa');
  });

  it('アップロード中に解除した画像が後から成功しても、その予約を破棄する', async () => {
    const { uploader, pending } = controllableUploader();
    renderPicker(uploader);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('画像を追加'), [png('1.png')]);

    await user.click(screen.getByRole('button', { name: '画像1を削除' }));
    await act(async () => pending[0].resolve({ ok: true, uploadId: '00000000-0000-4000-8000-0000000000bb' }));

    expect(uploader.discardUpload).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000bb');
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
