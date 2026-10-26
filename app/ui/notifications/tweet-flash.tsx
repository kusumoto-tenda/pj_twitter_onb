'use client';

import { useEffect, useState } from 'react';
import { consumeFlashCookie } from './consume-flash-cookie';
import { TWEET_FLASHES, TWEET_FLASH_COOKIE, TWEET_FLASH_MESSAGES, type TweetFlashValue } from './flash';
import { Toast } from './toast';

/** 投稿後（メイン画面）・未ログインでの投稿・編集・削除時（ログイン画面）の通知を一度だけ3秒表示する。 */
export function TweetFlash() {
  const [flash, setFlash] = useState<{ value: TweetFlashValue; at: number } | null>(null);

  useEffect(() => {
    // Strict Modeの二重実行でも、Cookieは最初の1回で消費されるため重複しない。
    const value = TWEET_FLASHES.find((candidate) => consumeFlashCookie(TWEET_FLASH_COOKIE, candidate));
    if (value) setFlash({ value, at: Date.now() });
  }, []);

  return (
    <Toast
      message={flash ? TWEET_FLASH_MESSAGES[flash.value] : ''}
      tone="success"
      trigger={flash?.at ?? null}
    />
  );
}
