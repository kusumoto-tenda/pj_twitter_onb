'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';

export type ToastTone = 'success' | 'error';
export const TOAST_DURATION_MS = 3000;

/**
 * 画面上部に3秒間表示する通知。
 * triggerが新しい値に変わるたびに表示を再開する（nullなら表示しない）。
 */
export function Toast({
  message,
  tone,
  trigger,
}: {
  message: string;
  tone: ToastTone;
  trigger: string | number | null;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (trigger === null) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [trigger]);

  if (!visible) return null;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full px-6 py-3 text-sm font-bold text-white shadow-lg',
        tone === 'error' ? 'bg-red-600' : 'bg-sky-500',
      )}
    >
      {message}
    </div>
  );
}
