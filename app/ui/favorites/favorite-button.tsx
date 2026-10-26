'use client';

import { BookmarkIcon as BookmarkOutline } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolid } from '@heroicons/react/24/solid';
import { useEffect, useRef, useState, useTransition } from 'react';
import { setFavoriteAction } from '@/app/favorites/actions';
import { useActionFeedback } from '@/app/ui/notifications/action-feedback-provider';

const NETWORK_ERROR_MESSAGE = '通信に失敗しました。時間をおいて再度お試しください';

/**
 * お気に入り（自分専用の保存）のボタン。デザイン案の旗のようなアイコン（bookmark）で、いいね（♡）とは別。
 * 表示する状態はサーバーで取得したDBの値（active）だけで、押したら次の状態を明示して送る（トグルにしない）。
 * 成功後はServer Actionの再取得で、同じ元投稿を表示するカードすべてに新しい状態が反映される。
 */
export function FavoriteButton({
  tweetId,
  active,
  expectedActorId,
  action = setFavoriteAction,
}: {
  tweetId: string;
  active: boolean;
  /** 画面を表示したときのログイン中の利用者。未ログインならnull。認可はActionで改めて行う。 */
  expectedActorId: string | null;
  action?: typeof setFavoriteAction;
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
        const result = await action(formData);
        // 失敗しても表示中の状態は変えない（楽観的に切り替えない）。
        if (!result.ok) notify(result.message, 'error');
      } catch {
        // 通信の切断などでAction自体が失敗した場合も、エラー境界へ進めず通知して再試行できるようにする。
        notify(NETWORK_ERROR_MESSAGE, 'error');
      } finally {
        sending.current = false;
      }
    });
  };

  const Icon = active ? BookmarkSolid : BookmarkOutline;
  return (
    <button
      type="button"
      aria-label={active ? 'お気に入りを解除' : 'お気に入りに追加'}
      aria-pressed={active}
      aria-busy={pending}
      // サーバー描画直後の、まだ操作できない状態でのクリックを空振りさせない。
      disabled={!hydrated || pending}
      onClick={submit}
      className={`rounded-full p-1.5 hover:bg-sky-50 disabled:opacity-50 ${active ? 'text-sky-600' : 'text-gray-500'}`}
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}
