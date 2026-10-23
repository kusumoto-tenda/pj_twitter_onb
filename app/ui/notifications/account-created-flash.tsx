'use client';

import { useEffect, useState } from 'react';
import { ACCOUNT_CREATED_FLASH, ACCOUNT_CREATED_MESSAGE, FLASH_COOKIE } from './flash';
import { Toast } from './toast';

/** 通知Cookieが指定の値なら削除してtrueを返す。一度しか消費できない。 */
function consumeFlashCookie(expected: string): boolean {
  const found = document.cookie
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === `${FLASH_COOKIE}=${expected}`);
  if (found) document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0`;
  return found;
}

/** 登録直後の遷移先でだけマウントし、「アカウントを作成しました」を一度だけ表示する。 */
export function AccountCreatedFlash() {
  const [trigger, setTrigger] = useState<number | null>(null);

  useEffect(() => {
    // Strict Modeの二重実行でも、Cookieは最初の1回で消費されるため重複しない。
    if (consumeFlashCookie(ACCOUNT_CREATED_FLASH)) setTrigger(Date.now());
  }, []);

  return <Toast message={ACCOUNT_CREATED_MESSAGE} tone="success" trigger={trigger} />;
}
