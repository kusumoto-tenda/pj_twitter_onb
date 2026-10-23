'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
  // 操作した時点で表示を切り替える。URLの条件が変わったら（遷移完了・戻る操作）要求は無効になる。
  const [requested, setRequested] = useState<{ from: boolean; to: boolean } | null>(null);
  const checked = requested?.from === followingOnly ? requested.to : followingOnly;

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
        checked={checked}
        disabled={pending}
        onChange={() => {
          setRequested({ from: followingOnly, to: !followingOnly });
          startTransition(() => router.push(toggleHref));
        }}
        className="h-5 w-5 rounded border-2 border-gray-900 text-sky-500"
      />
      フォローのみ
    </label>
  );
}
