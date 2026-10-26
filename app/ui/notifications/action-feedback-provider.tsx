'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Toast, type ToastTone } from './toast';

type Notify = (message: string, tone: ToastTone) => void;

const Context = createContext<Notify | null>(null);

/**
 * 画面内の操作の結果を3秒表示する。Server Action後の再取得でページが作り直されても通知を失わないよう、
 * ルートのlayoutで持つ。表示だけを担当し、DB・権限・投稿の状態は持たない。
 */
export function ActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<{ message: string; tone: ToastTone; at: number } | null>(null);
  const notify = useCallback<Notify>((message, tone) => setFeedback({ message, tone, at: Date.now() }), []);

  return (
    <Context.Provider value={notify}>
      {children}
      <Toast message={feedback?.message ?? ''} tone={feedback?.tone ?? 'success'} trigger={feedback?.at ?? null} />
    </Context.Provider>
  );
}

export function useActionFeedback(): Notify {
  const notify = useContext(Context);
  if (!notify) throw new Error('ActionFeedbackProvider の内側で使ってください');
  return notify;
}
