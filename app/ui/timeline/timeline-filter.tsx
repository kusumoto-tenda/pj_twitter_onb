'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** 「フォローのみ」の切り替え。条件はURLに持たせ、切り替え時はページの先頭へ戻る。 */
export function TimelineFilter({
  loggedIn,
  followingOnly,
  toggleHref,
}: {
  loggedIn: boolean;
  followingOnly: boolean;
  /** 切り替え後のURL（カーソルなし）。 */
  toggleHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!loggedIn) {
    return (
      <Link href="/login" className="text-sm font-bold text-sky-600 underline">
        ログインしてフォローのみを表示
      </Link>
    );
  }

  return (
    <label className="flex cursor-pointer items-center gap-2 font-bold">
      <input
        type="checkbox"
        checked={followingOnly}
        disabled={pending}
        onChange={() => startTransition(() => router.push(toggleHref))}
        className="h-5 w-5 rounded border-2 border-gray-900 text-sky-500"
      />
      フォローのみ
    </label>
  );
}
