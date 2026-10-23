'use client';

import { useEffect, useState } from 'react';
import { consumeFlashCookie } from './consume-flash-cookie';
import { ACCOUNT_CREATED_FLASH, ACCOUNT_CREATED_MESSAGE, FLASH_COOKIE } from './flash';
import { Toast } from './toast';

/** 登録直後の遷移先でだけマウントし、「アカウントを作成しました」を一度だけ表示する。 */
export function AccountCreatedFlash() {
  const [trigger, setTrigger] = useState<number | null>(null);

  useEffect(() => {
    // Strict Modeの二重実行でも、Cookieは最初の1回で消費されるため重複しない。
    if (consumeFlashCookie(FLASH_COOKIE, ACCOUNT_CREATED_FLASH)) setTrigger(Date.now());
  }, []);

  return <Toast message={ACCOUNT_CREATED_MESSAGE} tone="success" trigger={trigger} />;
}
