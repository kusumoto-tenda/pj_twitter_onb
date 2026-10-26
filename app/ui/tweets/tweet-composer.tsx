'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditableTweet } from '@/application/tweets/ports/tweet-editor';
import { beginTweetDraftAction, createTweetAction } from '@/app/tweets/actions';
import { beginTweetDeleteAction, deleteTweetAction } from '@/app/tweets/delete-actions';
import { beginTweetEditAction, updateTweetAction } from '@/app/tweets/edit-actions';
import { TWEET_ALREADY_DELETED_MESSAGE, TWEET_DELETED_MESSAGE, TWEET_UPDATED_MESSAGE } from '@/app/ui/notifications/flash';
import { Toast } from '@/app/ui/notifications/toast';
import { CreateTweetDialog, type CreateTweetAction } from './create-tweet-dialog';
import {
  DeleteTweetDialog,
  type DeleteDialogResult,
  type DeleteTarget,
  type DeleteTweetAction,
} from './delete-tweet-dialog';
import { EditTweetDialog, type UpdateTweetAction } from './edit-tweet-dialog';
import { restoreFocusWhenReady } from './dialog-focus';
import { blobImageUploader, type ImageUploader } from './image-uploader';

type BeginDraft = () => Promise<{ ok: true; draftId: string } | { ok: false; message: string }>;
type BeginEdit = (tweetId: string) => Promise<{ ok: true; value: EditableTweet } | { ok: false; message: string }>;
type BeginDelete = (tweetId: string) => Promise<{ ok: true; value: DeleteTarget } | { ok: false; message: string }>;

/** 作成・編集・削除の確認は同時に1つだけ開く。 */
type ComposerState =
  | null
  | { mode: 'create'; draftId: string }
  | { mode: 'edit'; value: EditableTweet; returnFocusKey: string }
  | { mode: 'delete'; target: DeleteTarget; returnFocusKey: string };

type ComposerContext = {
  open: () => void;
  openEdit: (tweetId: string, returnFocusKey: string) => void;
  openDelete: (tweetId: string, returnFocusKey: string) => void;
  /** 準備中、またはダイアログを開いている間はtrue。 */
  busy: boolean;
  opening: boolean;
};

const Context = createContext<ComposerContext | null>(null);

export const LAUNCHER_SELECTOR = '[data-tweet-launcher]';
export const menuSelector = (key: string) => `[data-tweet-menu-key="${CSS.escape(key)}"]`;

/** 起動元のカードが消えた後のフォーカス先。一覧の見出し（フォーカスできるようにする）。 */
function mainHeading(): HTMLElement | null {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  return heading;
}

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
  beginDelete = beginTweetDeleteAction,
  deleteAction = deleteTweetAction as DeleteTweetAction,
  uploader = blobImageUploader,
}: {
  children: ReactNode;
  beginDraft?: BeginDraft;
  action?: CreateTweetAction;
  beginEdit?: BeginEdit;
  updateAction?: UpdateTweetAction;
  beginDelete?: BeginDelete;
  deleteAction?: DeleteTweetAction;
  uploader?: ImageUploader;
}) {
  const [state, setState] = useState<ComposerState>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [deletedAt, setDeletedAt] = useState<number | null>(null);
  const [goneAt, setGoneAt] = useState<number | null>(null);

  // 閉じた後のフォーカス復帰の見守り。次のダイアログを開くとき・アンマウント時にやめる。
  const stopFocusRestore = useRef<(() => void) | null>(null);
  const restoreFocus = useCallback((find: () => HTMLElement | null) => {
    stopFocusRestore.current?.();
    stopFocusRestore.current = restoreFocusWhenReady(find);
  }, []);
  useEffect(() => () => stopFocusRestore.current?.(), []);

  const prepare = useCallback(async (run: () => Promise<ComposerState | string>) => {
    stopFocusRestore.current?.();
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

  const openDelete = useCallback(
    (tweetId: string, returnFocusKey: string) =>
      void prepare(async () => {
        const result = await beginDelete(tweetId);
        return result.ok ? { mode: 'delete', target: result.value, returnFocusKey } : result.message;
      }),
    [beginDelete, prepare],
  );

  const onDeleteClosed = useCallback((result: DeleteDialogResult, returnFocusKey: string) => {
    setState(null);
    // 成功の通知はここ（ルート）で1回だけ出す。ログイン画面へ移動した場合は通知しない。
    if (result === 'deleted') setDeletedAt(Date.now());
    if (result === 'gone') setGoneAt(Date.now());
    if (result === 'redirected') return;
    // 取り消したら起動元へ戻す。削除後は起動元のカードが消えるため、一覧の見出しへ移す。
    // どちらも再取得中は表示されていないことがあるため、再表示を待って移す。
    restoreFocus(
      result === 'cancelled' ? () => document.querySelector<HTMLElement>(menuSelector(returnFocusKey)) : mainHeading,
    );
  }, [restoreFocus]);

  const onClosed = useCallback(
    (selector: string, updated = false) => {
      setState(null);
      if (updated) setUpdatedAt(Date.now());
      // 閉じたら起動元へフォーカスを戻す。再取得でボタンが作り直される・一時的に消える場合も、再表示を待って戻す。
      restoreFocus(() => document.querySelector<HTMLElement>(selector));
    },
    [restoreFocus],
  );

  return (
    <Context.Provider value={{ open, openEdit, openDelete, opening, busy: opening || state !== null }}>
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
      <Toast message={TWEET_DELETED_MESSAGE} tone="success" trigger={deletedAt} />
      <Toast message={TWEET_ALREADY_DELETED_MESSAGE} tone="success" trigger={goneAt} />
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
      {state?.mode === 'delete' && (
        <DeleteTweetDialog
          key={`${state.target.tweetId}:${state.returnFocusKey}`}
          target={state.target}
          action={deleteAction}
          onClosed={(result) => onDeleteClosed(result, state.returnFocusKey)}
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
