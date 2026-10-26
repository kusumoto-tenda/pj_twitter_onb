'use client';

import { ArrowPathRoundedSquareIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState, useTransition } from 'react';
import { setRetweetAction } from '@/app/retweets/actions';
import { useActionFeedback } from '@/app/ui/notifications/action-feedback-provider';
import { invokeDialogAction } from '@/app/ui/tweets/invoke-dialog-action';

const NETWORK_ERROR_MESSAGE = '通信に失敗しました。時間をおいて再度お試しください';

/**
 * 元投稿のリツイート・解除のボタンと公開件数。
 * 表示する状態・件数はサーバーで取得したDBの値だけで、押したら次の状態を明示して送る（トグルにしない）。
 * 成功後はServer Actionの再取得で、同じ元投稿を表示するカードすべてと、自分のリツイートの出来事が更新される。
 */
export function RetweetButton({
  tweetId,
  active,
  count,
  expectedActorId,
  action = setRetweetAction,
}: {
  /** 元投稿のUUID（リツイートのカードでもリツイート行ではなく元投稿）。 */
  tweetId: string;
  active: boolean;
  count: number;
  /** 画面を表示したときのログイン中の利用者。未ログインならnull。認可はActionで改めて行う。 */
  expectedActorId: string | null;
  action?: typeof setRetweetAction;
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
    formData.set('tweetId', tweetId);
    formData.set('active', String(!active));
    if (expectedActorId !== null) formData.set('expectedActorId', expectedActorId);
    startTransition(async () => {
      try {
        // 通信の切断などの一般的なrejectは失敗結果にし、Next.jsの制御例外はそのまま再throwされる。
        const outcome = await invokeDialogAction(() => action(formData));
        // 失敗しても表示中の状態・件数は変えない（楽観的に切り替えない）。
        if (!outcome.ok) notify(NETWORK_ERROR_MESSAGE, 'error');
        else if (!outcome.value.ok) notify(outcome.value.message, 'error');
      } finally {
        sending.current = false;
      }
    });
  };

  return (
    <span className={`inline-flex items-center gap-1 text-sm ${active ? 'text-green-600' : 'text-gray-500'}`}>
      <button
        type="button"
        aria-label={active ? 'リツイートを解除' : 'リツイートする'}
        aria-pressed={active}
        aria-busy={pending}
        // サーバー描画直後の、まだ操作できない状態でのクリックを空振りさせない。
        disabled={!hydrated || pending}
        onClick={submit}
        className="rounded-full p-1.5 hover:bg-green-50 disabled:opacity-50"
      >
        <ArrowPathRoundedSquareIcon aria-hidden="true" className={`h-5 w-5 ${active ? 'stroke-2' : ''}`} />
      </button>
      {/* 公開件数。読み上げでは「リツイートN件」、画面では数字だけを表示する。 */}
      <span className="sr-only">リツイート{count}件</span>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}
