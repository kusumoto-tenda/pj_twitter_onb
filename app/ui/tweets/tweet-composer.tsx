'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { EditableTweet } from '@/application/tweets/ports/tweet-editor';
import { beginTweetDraftAction, createTweetAction } from '@/app/tweets/actions';
import { beginTweetEditAction, updateTweetAction } from '@/app/tweets/edit-actions';
import { TWEET_UPDATED_MESSAGE } from '@/app/ui/notifications/flash';
import { Toast } from '@/app/ui/notifications/toast';
import { CreateTweetDialog, type CreateTweetAction } from './create-tweet-dialog';
import { EditTweetDialog, type UpdateTweetAction } from './edit-tweet-dialog';
import { blobImageUploader, type ImageUploader } from './image-uploader';

type BeginDraft = () => Promise<{ ok: true; draftId: string } | { ok: false; message: string }>;
type BeginEdit = (tweetId: string) => Promise<{ ok: true; value: EditableTweet } | { ok: false; message: string }>;

/** 作成と編集は同時に1つだけ開く。 */
type ComposerState =
  | null
  | { mode: 'create'; draftId: string }
  | { mode: 'edit'; value: EditableTweet; returnFocusKey: string };

type ComposerContext = {
  open: () => void;
  openEdit: (tweetId: string, returnFocusKey: string) => void;
  /** 準備中、またはダイアログを開いている間はtrue。 */
  busy: boolean;
  opening: boolean;
};

const Context = createContext<ComposerContext | null>(null);

export const LAUNCHER_SELECTOR = '[data-tweet-launcher]';
export const menuSelector = (key: string) => `[data-tweet-menu-key="${CSS.escape(key)}"]`;

/**
 * 投稿の作成・編集ダイアログの状態をルートのlayoutで持つ。
 * Server Action後の画面の再取得（読み込み表示への置き換え）でページ内のボタンが作り直されても、
 * 準備中の下書きや入力中の内容を失わない。
 */
export function TweetComposerProvider({
  children,
  beginDraft = beginTweetDraftAction,
  action = createTweetAction as CreateTweetAction,
  beginEdit = beginTweetEditAction,
  updateAction = updateTweetAction as UpdateTweetAction,
  uploader = blobImageUploader,
}: {
  children: ReactNode;
  beginDraft?: BeginDraft;
  action?: CreateTweetAction;
  beginEdit?: BeginEdit;
  updateAction?: UpdateTweetAction;
  uploader?: ImageUploader;
}) {
  const [state, setState] = useState<ComposerState>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const prepare = useCallback(async (run: () => Promise<ComposerState | string>) => {
    setOpening(true);
    setError(null);
    try {
      // 開く直前にサーバーで利用者・所有者を確認する。未ログインならサーバーがログイン画面へ移動させる。
      const result = await run();
      if (typeof result === 'string') setError(result);
      else setState(result);
    } finally {
      setOpening(false);
    }
  }, []);

  const open = useCallback(
    () =>
      void prepare(async () => {
        const result = await beginDraft();
        return result.ok ? { mode: 'create', draftId: result.draftId } : result.message;
      }),
    [beginDraft, prepare],
  );

  const openEdit = useCallback(
    (tweetId: string, returnFocusKey: string) =>
      void prepare(async () => {
        const result = await beginEdit(tweetId);
        return result.ok ? { mode: 'edit', value: result.value, returnFocusKey } : result.message;
      }),
    [beginEdit, prepare],
  );

  const onClosed = useCallback(
    (selector: string, updated = false) => {
      setState(null);
      if (updated) setUpdatedAt(Date.now());
      // 閉じたら起動元へフォーカスを戻す（ボタンが作り直されていても見つけられるようにする）。
      requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
    },
    [],
  );

  return (
    <Context.Provider value={{ open, openEdit, opening, busy: opening || state !== null }}>
      {children}
      {error && (
        <p
          role="alert"
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-red-600 px-6 py-3 text-sm font-bold text-white shadow-lg"
        >
          {error}
        </p>
      )}
      {/* 更新の成功は画面を移動せずに知らせる（現在のURL・一覧の位置を保つ）。 */}
      <Toast message={TWEET_UPDATED_MESSAGE} tone="success" trigger={updatedAt} />
      {state?.mode === 'create' && (
        <CreateTweetDialog
          key={state.draftId}
          draftId={state.draftId}
          action={action}
          uploader={uploader}
          onClosed={() => onClosed(LAUNCHER_SELECTOR)}
        />
      )}
      {state?.mode === 'edit' && (
        <EditTweetDialog
          key={state.value.draftId}
          value={state.value}
          action={updateAction}
          uploader={uploader}
          onClosed={(updated) => onClosed(menuSelector(state.returnFocusKey), updated)}
        />
      )}
    </Context.Provider>
  );
}

export function useTweetComposer(): ComposerContext {
  const context = useContext(Context);
  if (!context) throw new Error('TweetComposerProvider の内側で使ってください');
  return context;
}
