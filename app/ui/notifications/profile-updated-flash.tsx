'use client';

import { useEffect, useState } from 'react';
import { consumeFlashCookie } from './consume-flash-cookie';
import { PROFILE_UPDATED_COOKIE, PROFILE_UPDATED_FLASH, PROFILE_UPDATED_MESSAGE } from './flash';
import { Toast } from './toast';

/** プロフィール画面でマウントし、更新直後だけ「プロフィールを更新しました」を一度表示する。 */
export function ProfileUpdatedFlash() {
  const [trigger, setTrigger] = useState<number | null>(null);

  useEffect(() => {
    // Strict Modeの二重実行でも、Cookieは最初の1回で消費されるため重複しない。
    if (consumeFlashCookie(PROFILE_UPDATED_COOKIE, PROFILE_UPDATED_FLASH)) setTrigger(Date.now());
  }, []);

  return <Toast message={PROFILE_UPDATED_MESSAGE} tone="success" trigger={trigger} />;
}
