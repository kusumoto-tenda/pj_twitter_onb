'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { initialCreateTweetState, type CreateTweetFormState } from '@/app/tweets/form-state';
import {
  ACTION_NETWORK_FAILED_MESSAGE,
  DIALOG_NETWORK_UNCONFIRMED_MESSAGE,
  TWEET_FAILED_MESSAGE,
} from '@/app/ui/notifications/flash';
import { Toast } from '@/app/ui/notifications/toast';
import { TWEET_CONTENT_MAX_LENGTH } from '@/domain/value_objects/tweets/tweet-validation';
import type { ImageUploader } from './image-uploader';
import { invokeDialogAction } from './invoke-dialog-action';
import { trapFocus } from './dialog-focus';
import { TweetImagePicker, type PickerState } from './tweet-image-picker';

export type CreateTweetAction = (
  state: CreateTweetFormState,
  formData: FormData,
) => Promise<CreateTweetFormState | undefined>;

/**
 * 投稿ダイアログ（ネイティブの<dialog>をモーダルで開く）。
 * 背景クリックでは閉じず、閉じる・Escでキャンセルする。投稿の確定中は閉じられない。
 */
export function CreateTweetDialog({
  draftId,
  action,
  uploader,
  onClosed,
}: {
  draftId: string;
  action: CreateTweetAction;
  uploader: ImageUploader;
  /** 閉じた後に呼ぶ（published: 投稿に成功して閉じたか）。 */
  onClosed: (published: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('');
  const [images, setImages] = useState<PickerState>({ uploadIds: [], busy: false });
  const closed = useRef(false);

  const finish = useCallback(
    (published: boolean) => {
      if (closed.current) return;
      closed.current = true;
      // キャンセルでは下書きと画像を破棄する（投稿済みなら破棄しない）。
      if (!published) uploader.discardDraft(draftId);
      dialogRef.current?.close();
      onClosed(published);
    },
    [draftId, onClosed, uploader],
  );

  // Server Actionがメイン画面へ移動した（成功した）場合は、結果の状態が返らない。
  const [state, formAction, pending] = useActionState(
    async (previous: CreateTweetFormState, formData: FormData): Promise<CreateTweetFormState> => {
      const outcome = await invokeDialogAction(() => action(previous, formData));
      // 通信の失敗では閉じず、下書きも破棄しない。同じ下書きのまま利用者が再試行できる。
      if (!outcome.ok) {
        return {
          status: 'error',
          code: 'NETWORK_ERROR',
          message: DIALOG_NETWORK_UNCONFIRMED_MESSAGE,
          fieldErrors: {},
          attempt: previous.status === 'error' ? previous.attempt + 1 : 1,
        };
      }
      const result = outcome.value;
      if (!result) {
        finish(true);
        return previous;
      }
      return result;
    },
    initialCreateTweetState,
  );
  const failed = state.status === 'error' ? state : null;

  useEffect(() => {
    // StrictModeではEffectが再実行されるため、開いていないときだけモーダルで開く。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    textareaRef.current?.focus();
  }, []);

  const count = Array.from(content).length;
  const contentErrors = failed?.fieldErrors.content ?? [];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="create-tweet-title"
      onKeyDown={trapFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) finish(false);
      }}
      className="w-[calc(100%-2rem)] max-w-xl rounded-2xl p-0 backdrop:bg-black/40"
    >
      <Toast
        message={failed?.code === 'NETWORK_ERROR' ? ACTION_NETWORK_FAILED_MESSAGE : TWEET_FAILED_MESSAGE}
        tone="error"
        trigger={failed?.attempt ?? null}
      />
      <form action={formAction} className="flex max-h-[85vh] flex-col">
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={() => finish(false)}
            disabled={pending}
            className="rounded-full px-3 py-1 font-bold hover:bg-gray-100 disabled:opacity-50"
          >
            閉じる
          </button>
          <h2 id="create-tweet-title" className="flex-1 text-lg font-bold">
            ツイートを作成
          </h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <input type="hidden" name="draftId" value={draftId} />
          {images.uploadIds.map((uploadId) => (
            <input key={uploadId} type="hidden" name="uploadIds" value={uploadId} />
          ))}
          {failed?.message && (
            <p className="text-sm text-red-600" role="status">
              {failed.message}
            </p>
          )}
          <label htmlFor="tweet-content" className="block text-sm font-bold">
            本文
          </label>
          <textarea
            ref={textareaRef}
            id="tweet-content"
            name="content"
            rows={5}
            value={content}
            readOnly={pending}
            onChange={(event) => setContent(event.target.value)}
            aria-invalid={contentErrors.length > 0}
            aria-describedby={contentErrors.length > 0 ? 'tweet-content-error' : 'tweet-content-count'}
            className="block w-full resize-y rounded-lg border-2 border-gray-300 p-3 text-base outline-none focus:border-sky-500 aria-[invalid=true]:border-red-600"
          />
          <p
            id="tweet-content-count"
            className={`text-right text-sm ${count > TWEET_CONTENT_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'}`}
          >
            {count} / {TWEET_CONTENT_MAX_LENGTH}
          </p>
          {contentErrors.length > 0 && (
            <ul id="tweet-content-error" className="text-sm text-red-600">
              {contentErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <TweetImagePicker
            draftId={draftId}
            uploader={uploader}
            disabled={pending}
            onChange={setImages}
            errors={failed?.fieldErrors.images}
          />
        </div>
        <div className="flex justify-end border-t border-gray-200 px-4 py-3">
          <button
            type="submit"
            disabled={pending || images.busy}
            aria-busy={pending}
            className="rounded-full bg-sky-500 px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '投稿中…' : 'ツイートする'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
