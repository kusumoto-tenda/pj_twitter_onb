'use client';

import { useEffect, useState } from 'react';
import { consumeFlashCookie } from './consume-flash-cookie';
import {
  ACCOUNT_DELETED_COOKIE,
  ACCOUNT_DELETED_FLASHES,
  ACCOUNT_DELETED_MESSAGES,
  type AccountDeletedFlash as Flash,
} from './flash';
import { Toast } from './toast';

/**
 * アカウント削除後にログイン画面で一度だけ表示する通知。
 * 削除成功は3秒のToast、ログアウトの後処理失敗・対象なしは見落とさないよう固定表示にする。
 */
export function AccountDeletedFlash() {
  const [flash, setFlash] = useState<{ value: Flash; at: number } | null>(null);

  useEffect(() => {
    // Strict Modeの二重実行でも、Cookieは最初の1回で消費されるため重複しない。
    const value = ACCOUNT_DELETED_FLASHES.find((candidate) =>
      consumeFlashCookie(ACCOUNT_DELETED_COOKIE, candidate),
    );
    if (value) setFlash({ value, at: Date.now() });
  }, []);

  if (flash && flash.value !== 'deleted') {
    return (
      <div
        role="alert"
        className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 shadow-lg"
      >
        {ACCOUNT_DELETED_MESSAGES[flash.value]}
      </div>
    );
  }
  return (
    <Toast
      message={ACCOUNT_DELETED_MESSAGES.deleted}
      tone="success"
      trigger={flash?.value === 'deleted' ? flash.at : null}
    />
  );
}
