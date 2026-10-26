'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import type { EditableTweet } from '@/application/tweets/ports/tweet-editor';
import { initialEditTweetState, type EditTweetFormState } from '@/app/tweets/edit-form-state';
import {
  ACTION_NETWORK_FAILED_MESSAGE,
  DIALOG_NETWORK_UNCONFIRMED_MESSAGE,
  TWEET_UPDATE_FAILED_MESSAGE,
} from '@/app/ui/notifications/flash';
import { Toast } from '@/app/ui/notifications/toast';
import { MAX_IMAGES_PER_TWEET, TWEET_CONTENT_MAX_LENGTH } from '@/domain/tweets/tweet-validation';
import { trapFocus } from './dialog-focus';
import { EditTweetImages } from './edit-tweet-images';
import type { ImageUploader } from './image-uploader';
import { invokeDialogAction } from './invoke-dialog-action';
import { TweetImagePicker, type PickerState } from './tweet-image-picker';

export type UpdateTweetAction = (
  state: EditTweetFormState,
  formData: FormData,
) => Promise<EditTweetFormState | undefined>;

/**
 * ツイート編集ダイアログ。作成ダイアログと同じく、背景クリックでは閉じず、閉じる・Escで保存せずに閉じる。
 * 保存中は入力・添付・閉じる操作を受け付けない。
 */
export function EditTweetDialog({
  value,
  action,
  uploader,
  onClosed,
}: {
  value: EditableTweet;
  action: UpdateTweetAction;
  uploader: ImageUploader;
  /** 閉じた後に呼ぶ（updated: 更新に成功して閉じたか）。 */
  onClosed: (updated: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState(value.content);
  const [keepImageIds, setKeepImageIds] = useState(() => value.images.map((image) => image.id));
  const [images, setImages] = useState<PickerState>({ uploadIds: [], busy: false });
  const closed = useRef(false);

  const finish = useCallback(
    (updated: boolean) => {
      if (closed.current) return;
      closed.current = true;
      // 保存せずに閉じたら、この編集用の下書き（新規画像だけ）を破棄する。元の投稿の画像は残る。
      if (!updated) uploader.discardDraft(value.draftId);
      dialogRef.current?.close();
      onClosed(updated);
    },
    [onClosed, uploader, value.draftId],
  );

  const [state, formAction, pending] = useActionState(
    async (previous: EditTweetFormState, formData: FormData): Promise<EditTweetFormState> => {
      const outcome = await invokeDialogAction(() => action(previous, formData));
      // 通信の失敗では閉じず、下書きも破棄しない。確定済みでも同じ下書きの再送は既存の再送判定で成功になる。
      if (!outcome.ok) {
        return {
          status: 'error',
          code: 'NETWORK_ERROR',
          message: DIALOG_NETWORK_UNCONFIRMED_MESSAGE,
          fieldErrors: {},
          attempt: previous.status === 'idle' ? 1 : previous.attempt + 1,
        };
      }
      const result = outcome.value;
      // 未ログインでログイン画面へ移動した場合は結果が返らない。残ったダイアログは閉じる。
      if (!result) {
        finish(true);
        return previous;
      }
      return result;
    },
    initialEditTweetState,
  );
  const failed = state.status === 'error' ? state : null;

  useEffect(() => {
    if (state.status === 'success') finish(true);
  }, [state, finish]);

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
      aria-labelledby="edit-tweet-title"
      onKeyDown={trapFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) finish(false);
      }}
      className="w-[calc(100%-2rem)] max-w-xl rounded-2xl p-0 backdrop:bg-black/40"
    >
      <Toast
        message={failed?.code === 'NETWORK_ERROR' ? ACTION_NETWORK_FAILED_MESSAGE : TWEET_UPDATE_FAILED_MESSAGE}
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
          <h2 id="edit-tweet-title" className="flex-1 text-lg font-bold">
            ツイートを編集
          </h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <input type="hidden" name="draftId" value={value.draftId} />
          {keepImageIds.map((id) => (
            <input key={id} type="hidden" name="keepImageIds" value={id} />
          ))}
          {images.uploadIds.map((id) => (
            <input key={id} type="hidden" name="uploadIds" value={id} />
          ))}
          {failed?.message && (
            <p className="text-sm text-red-600" role="status">
              {failed.message}
            </p>
          )}
          <label htmlFor="edit-tweet-content" className="block text-sm font-bold">
            本文
          </label>
          <textarea
            ref={textareaRef}
            id="edit-tweet-content"
            name="content"
            rows={5}
            value={content}
            readOnly={pending}
            onChange={(event) => setContent(event.target.value)}
            aria-invalid={contentErrors.length > 0}
            aria-describedby={contentErrors.length > 0 ? 'edit-tweet-content-error' : 'edit-tweet-content-count'}
            className="block w-full resize-y rounded-lg border-2 border-gray-300 p-3 text-base outline-none focus:border-sky-500 aria-[invalid=true]:border-red-600"
          />
          <p
            id="edit-tweet-content-count"
            className={`text-right text-sm ${count > TWEET_CONTENT_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'}`}
          >
            {count} / {TWEET_CONTENT_MAX_LENGTH}
          </p>
          {contentErrors.length > 0 && (
            <ul id="edit-tweet-content-error" className="text-sm text-red-600">
              {contentErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <EditTweetImages
            images={value.images}
            keepImageIds={keepImageIds}
            disabled={pending}
            onRemove={(id) => setKeepImageIds((current) => current.filter((keep) => keep !== id))}
          />
          {/* 新規画像の枠は、保持する既存画像の数を引いた分。既存画像と新規の予約は別々に扱う。 */}
          <TweetImagePicker
            draftId={value.draftId}
            uploader={uploader}
            disabled={pending}
            onChange={setImages}
            errors={failed?.fieldErrors.images}
            maxImages={MAX_IMAGES_PER_TWEET - keepImageIds.length}
          />
        </div>
        <div className="flex justify-end border-t border-gray-200 px-4 py-3">
          <button
            type="submit"
            disabled={pending || images.busy}
            aria-busy={pending}
            className="rounded-full bg-sky-500 px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '更新中…' : '更新'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
