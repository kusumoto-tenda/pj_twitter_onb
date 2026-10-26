'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** 取得失敗の表示。現在のURL条件のまま再取得する。 */
export function TimelineRetry({
  message = '投稿を取得できませんでした。時間をおいて再度お試しください',
}: {
  message?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="px-4 py-10 text-center text-gray-700">
      <p>{message}</p>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(() => router.refresh())}
        className="mt-3 rounded-full bg-sky-500 px-6 py-2 font-bold text-white disabled:cursor-wait disabled:opacity-50"
      >
        再試行
      </button>
    </div>
  );
}
