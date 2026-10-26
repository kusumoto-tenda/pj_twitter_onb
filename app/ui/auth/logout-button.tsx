'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { logoutAction } from '@/app/logout/actions';
import { initialLogoutState, type LogoutFormState } from '@/app/logout/form-state';
import { useActionFeedback } from '@/app/ui/notifications/action-feedback-provider';
import { LOGOUT_FAILED_MESSAGE } from '@/app/ui/notifications/flash';
import { invokeDialogAction } from '@/app/ui/tweets/invoke-dialog-action';
import { useTweetComposer } from '@/app/ui/tweets/tweet-composer';

/**
 * 現在のブラウザのログアウト。ナビと自分のプロフィールで同じActionを使う。
 * 投稿ダイアログの準備中・表示中は押せず、処理中は投稿ダイアログを準備させない。
 * 成功するとActionが/loginへ移動させる。失敗時はその場で通知し、再試行できる。
 */
export function LogoutButton({
  expectedActorId,
  action = logoutAction,
}: {
  /** 画面を表示したときのログイン中の利用者のUUID。送信時のセッションと違えばActionが拒否する。 */
  expectedActorId: string;
  action?: typeof logoutAction;
}) {
  const notify = useActionFeedback();
  const { busy, claimLogout, releaseLogout } = useTweetComposer();
  const [hydrated, setHydrated] = useState(false);
  // このボタンがロックを持っているか。成功時は移動で外れるまで保ち、ログイン画面をダイアログで覆わない。
  const claimed = useRef(false);

  useEffect(() => setHydrated(true), []);
  useEffect(
    () => () => {
      if (claimed.current) releaseLogout();
      claimed.current = false;
    },
    [releaseLogout],
  );

  const [, formAction, pending] = useActionState(async (previous: LogoutFormState, formData: FormData) => {
    // 通信の切断などの一般的なrejectは失敗結果にし、redirect等のNext.jsの制御例外はそのまま再throwされる。
    const outcome = await invokeDialogAction(() => action(previous, formData));
    const next: LogoutFormState = outcome.ok
      ? outcome.value
      : {
          status: 'error',
          code: 'UNAVAILABLE',
          message: LOGOUT_FAILED_MESSAGE,
          attempt: previous.status === 'error' ? previous.attempt + 1 : 1,
        };
    // 移動で外れたボタンの遅い応答は、新しいボタンのロックや通知を変更しない。
    if (next.status === 'error' && claimed.current) {
      claimed.current = false;
      releaseLogout();
      notify(next.message, 'error');
    }
    return next;
  }, initialLogoutState);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // 再描画を待たずに、連打・他のボタン・準備中のダイアログとの競合を止める。
    if (claimed.current || !claimLogout()) {
      event.preventDefault();
      return;
    }
    claimed.current = true;
  };

  return (
    <form action={formAction} onSubmit={onSubmit}>
      <input type="hidden" name="expectedActorId" value={expectedActorId} />
      <button
        type="submit"
        aria-busy={pending}
        // サーバー描画直後の、まだ操作できない状態でのクリックを空振りさせない。
        disabled={!hydrated || pending || busy}
        className="rounded-full border border-gray-300 px-4 py-1 text-sm font-bold text-gray-900 hover:bg-gray-100 disabled:opacity-50 md:w-full md:py-2"
      >
        {pending ? 'ログアウト中…' : 'ログアウト'}
      </button>
    </form>
  );
}
