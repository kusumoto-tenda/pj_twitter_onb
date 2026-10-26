'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { setFollowAction } from '@/app/follows/actions';
import { useActionFeedback } from '@/app/ui/notifications/action-feedback-provider';
import { invokeDialogAction } from '@/app/ui/tweets/invoke-dialog-action';

const NETWORK_ERROR_MESSAGE = '通信に失敗しました。時間をおいて再度お試しください';

/**
 * 他人のプロフィールのフォロー・解除ボタン。
 * 表示する状態はサーバーで取得したDBの値だけで、押したら次の状態を明示して送る（トグルにしない）。
 * 成功後はServer Actionの再取得で、人数・関係一覧・他ページでの状態が更新される。URL・タブはそのまま保つ。
 */
export function FollowButton({
  targetId,
  active,
  expectedActorId,
  action = setFollowAction,
}: {
  /** 表示中のプロフィールのUUID（表示IDではない）。表示後にIDが変わっても同じ人を操作する。 */
  targetId: string;
  active: boolean;
  /** 画面を表示したときのログイン中の利用者。未ログインならnull。認可はActionで改めて行う。 */
  expectedActorId: string | null;
  action?: typeof setFollowAction;
}) {
  const notify = useActionFeedback();
  const [hydrated, setHydrated] = useState(false);
  const [pending, startTransition] = useTransition();
  // 再描画を待たずに、連打による二重送信を止める。
  const sending = useRef(false);

  useEffect(() => setHydrated(true), []);

  const submit = () => {
    if (sending.current) return;
    sending.current = true;
    const formData = new FormData();
    formData.set('targetId', targetId);
    formData.set('active', String(!active));
    if (expectedActorId !== null) formData.set('expectedActorId', expectedActorId);
    startTransition(async () => {
      try {
        // 通信の切断などの一般的なrejectは失敗結果にし、Next.jsの制御例外はそのまま再throwされる。
        const outcome = await invokeDialogAction(() => action(formData));
        // 失敗しても表示中の状態は変えない（楽観的に切り替えない）。
        if (!outcome.ok) notify(NETWORK_ERROR_MESSAGE, 'error');
        else if (!outcome.value.ok) notify(outcome.value.message, 'error');
      } finally {
        sending.current = false;
      }
    });
  };

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-busy={pending}
      // サーバー描画直後の、まだ操作できない状態でのクリックを空振りさせない。
      disabled={!hydrated || pending}
      onClick={submit}
      className={
        active
          ? 'rounded-full border border-gray-300 px-4 py-1 text-sm font-bold text-gray-900 hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50'
          : 'rounded-full bg-gray-900 px-4 py-1 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50'
      }
    >
      {active ? 'フォロー解除' : 'フォローする'}
    </button>
  );
}
