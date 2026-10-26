'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { beginTweetDraftAction, createTweetAction } from '@/app/tweets/actions';
import { CreateTweetDialog, type CreateTweetAction } from './create-tweet-dialog';
import { blobImageUploader, type ImageUploader } from './image-uploader';

type BeginDraft = () => Promise<{ ok: true; draftId: string } | { ok: false; message: string }>;

/**
 * 「ツイートする」ボタン。押したときにサーバーで利用者を確認して下書きを作り、ダイアログを開く。
 * 未ログインならサーバーがログイン画面へ移動させる。
 */
export function CreateTweetLauncher({
  beginDraft = beginTweetDraftAction,
  action = createTweetAction as CreateTweetAction,
  uploader = blobImageUploader,
}: {
  beginDraft?: BeginDraft;
  action?: CreateTweetAction;
  uploader?: ImageUploader;
}) {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const onClosed = useCallback(() => {
    setDraftId(null);
    // 閉じたら起動ボタンへフォーカスを戻す。
    buttonRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        // 開いている間はモーダルの外になるため操作できない。閉じた直後にフォーカスを戻せるよう無効化はしない。
        disabled={opening}
        onClick={() =>
          startOpening(async () => {
            setError(null);
            const result = await beginDraft();
            if (result.ok) setDraftId(result.draftId);
            else setError(result.message);
          })
        }
        className="rounded-full bg-sky-500 px-4 py-2 font-bold text-white hover:bg-sky-600 disabled:opacity-60 md:w-full md:py-3"
      >
        ツイートする
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {draftId && (
        <CreateTweetDialog key={draftId} draftId={draftId} action={action} uploader={uploader} onClosed={onClosed} />
      )}
    </>
  );
}
