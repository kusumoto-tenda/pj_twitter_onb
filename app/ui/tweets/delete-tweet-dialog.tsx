'use client';

import { useActionState, useCallback, useEffect, useRef } from 'react';
import { initialDeleteTweetState, type DeleteTweetFormState } from '@/app/tweets/delete-form-state';
import { TWEET_DELETE_FAILED_MESSAGE } from '@/app/ui/notifications/flash';
import { Toast } from '@/app/ui/notifications/toast';
import { trapFocus } from './dialog-focus';

export type DeleteTweetAction = (
  state: DeleteTweetFormState,
  formData: FormData,
) => Promise<DeleteTweetFormState | undefined>;

export type DeleteTarget = { tweetId: string; actorId: string; content: string };

/**
 * cancelled: 「いいえ」・Escで閉じた / deleted: 削除した / gone: 既に削除されていた /
 * redirected: 未ログインでログイン画面へ移動した（削除成功としては扱わない）
 */
export type DeleteDialogResult = 'cancelled' | 'deleted' | 'gone' | 'redirected';

/**
 * ツイート削除の確認ダイアログ。削除は「はい」の送信時だけ行う。
 * 背景クリックでは閉じず、「いいえ」・Escでは何も変更せずに閉じる。削除中は全操作を受け付けない。
 */
export function DeleteTweetDialog({
  target,
  action,
  onClosed,
}: {
  target: DeleteTarget;
  action: DeleteTweetAction;
  onClosed: (result: DeleteDialogResult) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);

  const finish = useCallback(
    (result: DeleteDialogResult) => {
      if (closed.current) return;
      closed.current = true;
      dialogRef.current?.close();
      onClosed(result);
    },
    [onClosed],
  );

  const [state, formAction, pending] = useActionState(
    async (previous: DeleteTweetFormState, formData: FormData) => {
      const result = await action(previous, formData);
      // 未ログインでログイン画面へ移動した場合は結果が返らない。残ったダイアログは閉じる。
      if (!result) {
        finish('redirected');
        return previous;
      }
      return result;
    },
    initialDeleteTweetState,
  );
  const failed = state.status === 'error' ? state : null;

  useEffect(() => {
    if (state.status === 'success') finish('deleted');
    else if (state.status === 'not-found') finish('gone');
  }, [state, finish]);

  useEffect(() => {
    // StrictModeではEffectが再実行されるため、開いていないときだけモーダルで開く。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // 取り消せない操作なので、初期フォーカスは「いいえ」に置く。
    noRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-tweet-title"
      aria-describedby="delete-tweet-description"
      onKeyDown={trapFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) finish('cancelled');
      }}
      className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-0 backdrop:bg-black/40"
    >
      <Toast message={TWEET_DELETE_FAILED_MESSAGE} tone="error" trigger={failed?.attempt ?? null} />
      <form action={formAction} className="space-y-4 p-6">
        <input type="hidden" name="tweetId" value={target.tweetId} />
        <input type="hidden" name="expectedActorId" value={target.actorId} />
        <h2 id="delete-tweet-title" className="text-lg font-bold">
          本当に削除しますか？
        </h2>
        <p id="delete-tweet-description" className="text-sm text-gray-600">
          投稿・添付画像・この投稿へのリツイートは元に戻せません
        </p>
        {target.content && (
          <p className="line-clamp-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm [overflow-wrap:anywhere]">
            {target.content}
          </p>
        )}
        {failed && (
          <p className="text-sm text-red-600" role="status">
            {failed.message}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            ref={noRef}
            type="button"
            onClick={() => finish('cancelled')}
            disabled={pending}
            className="rounded-full border border-gray-300 px-5 py-2 font-bold hover:bg-gray-100 disabled:opacity-50"
          >
            いいえ
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="rounded-full bg-red-600 px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '削除中…' : 'はい'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
