'use client';

import { useEffect, useState } from 'react';
import { useTweetComposer } from './tweet-composer';

/** 「ツイートする」ボタン。ダイアログの状態はTweetComposerProviderが持つ。 */
export function CreateTweetLauncher() {
  const { open, opening } = useTweetComposer();
  // サーバー描画直後の、まだ操作できない状態でのクリックを空振りさせないよう、準備ができるまで無効にする。
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <button
      type="button"
      data-tweet-launcher
      disabled={!hydrated || opening}
      onClick={open}
      className="rounded-full bg-sky-500 px-4 py-2 font-bold text-white hover:bg-sky-600 disabled:opacity-60 md:w-full md:py-3"
    >
      ツイートする
    </button>
  );
}
