'use client';

import { useEffect, useState } from 'react';
import { consumeFlashCookie } from './consume-flash-cookie';
import { LOGGED_OUT_COOKIE, LOGGED_OUT_FLASH, LOGGED_OUT_MESSAGE } from './flash';
import { Toast } from './toast';

/** ログイン画面でログアウト完了の通知を一度だけ3秒間表示する。 */
export function LoggedOutFlash() {
  const [trigger, setTrigger] = useState<number | null>(null);

  useEffect(() => {
    // StrictModeの二重実行でも最初の1回だけCookieを消費する。
    if (consumeFlashCookie(LOGGED_OUT_COOKIE, LOGGED_OUT_FLASH)) setTrigger(Date.now());
  }, []);

  return <Toast message={LOGGED_OUT_MESSAGE} tone="success" trigger={trigger} />;
}
