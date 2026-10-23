'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

const MESSAGES = {
  profile: 'プロフィールを取得できませんでした',
  list: '一覧を取得できませんでした。時間をおいて再度お試しください',
} as const;

/** 取得失敗の表示。プロフィール全体と一覧部分を区別し、現在のURLのまま再取得する。 */
export function ProfileRetry({ scope }: { scope: keyof typeof MESSAGES }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="px-4 py-10 text-center text-gray-700">
      <p>{MESSAGES[scope]}</p>
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
