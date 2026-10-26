'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { beginTweetDraftAction, createTweetAction } from '@/app/tweets/actions';
import { CreateTweetDialog, type CreateTweetAction } from './create-tweet-dialog';
import { blobImageUploader, type ImageUploader } from './image-uploader';

type BeginDraft = () => Promise<{ ok: true; draftId: string } | { ok: false; message: string }>;

type ComposerContext = { open: () => void; opening: boolean };

const Context = createContext<ComposerContext | null>(null);

export const LAUNCHER_SELECTOR = '[data-tweet-launcher]';

/**
 * 投稿ダイアログの状態をルートのlayoutで持つ。
 * Server Action後の画面の再取得（読み込み表示への置き換え）でページ内のボタンが作り直されても、
 * 準備中の下書きや入力中の内容を失わない。
 */
export function TweetComposerProvider({
  children,
  beginDraft = beginTweetDraftAction,
  action = createTweetAction as CreateTweetAction,
  uploader = blobImageUploader,
}: {
  children: ReactNode;
  beginDraft?: BeginDraft;
  action?: CreateTweetAction;
  uploader?: ImageUploader;
}) {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setOpening(true);
    setError(null);
    try {
      // 開く直前にサーバーで利用者を確認して下書きを作る。未ログインならサーバーがログイン画面へ移動させる。
      const result = await beginDraft();
      if (result.ok) setDraftId(result.draftId);
      else setError(result.message);
    } finally {
      setOpening(false);
    }
  }, [beginDraft]);

  const onClosed = useCallback(() => {
    setDraftId(null);
    // 閉じたら起動ボタンへフォーカスを戻す（ボタンが作り直されていても見つけられるようにする）。
    requestAnimationFrame(() => document.querySelector<HTMLElement>(LAUNCHER_SELECTOR)?.focus());
  }, []);

  return (
    <Context.Provider value={{ open: () => void open(), opening }}>
      {children}
      {error && (
        <p
          role="alert"
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-red-600 px-6 py-3 text-sm font-bold text-white shadow-lg"
        >
          {error}
        </p>
      )}
      {draftId && (
        <CreateTweetDialog key={draftId} draftId={draftId} action={action} uploader={uploader} onClosed={onClosed} />
      )}
    </Context.Provider>
  );
}

export function useTweetComposer(): ComposerContext {
  const context = useContext(Context);
  if (!context) throw new Error('TweetComposerProvider の内側で使ってください');
  return context;
}
