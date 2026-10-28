'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_IMAGES_PER_TWEET, validateImageFile } from '@/domain/tweets/tweet-validation';
import type { ImageUploader } from './image-uploader';

type Attachment = {
  localId: number;
  file: File;
  previewUrl: string;
  status: 'uploading' | 'verifying' | 'ready' | 'error';
  uploadId?: string;
  error?: string;
  /** 解除・再試行で予約を破棄できなかったときの案内。予約IDは保持する。 */
  notice?: string;
  /** 予約の破棄を待っている間。 */
  releasing?: boolean;
  controller: AbortController;
};

const RELEASE_FAILED = '画像の解除に失敗しました。もう一度お試しください';

export type PickerState = { uploadIds: string[]; busy: boolean };

const STATUS_LABEL = { uploading: 'アップロード中', verifying: '確認中' } as const;

/**
 * 画像の選択・プレビュー・解除・再試行。選んだ直後に直接アップロードと検証を進め、
 * 準備できた画像IDを選択順で親へ知らせる（失敗・処理中・解除中の画像があればbusy）。
 */
export function TweetImagePicker({
  draftId,
  uploader,
  disabled,
  onChange,
  errors = [],
  maxImages = MAX_IMAGES_PER_TWEET,
}: {
  draftId: string;
  uploader: ImageUploader;
  disabled: boolean;
  onChange: (state: PickerState) => void;
  errors?: string[];
  /** 新規画像の枠。編集では保持する既存画像の数を引いた値を渡す（最終的な合計枚数はサーバーで確認する）。 */
  maxImages?: number;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const seq = useRef(0);
  const live = useRef<Attachment[]>([]);
  live.current = attachments;
  const mounted = useRef(true);
  /** アップロード中に解除を指示された画像（中断の結果を待って予約を破棄する）。 */
  const removing = useRef(new Set<number>());

  useEffect(() => {
    onChange({
      uploadIds: attachments.filter((a) => a.status === 'ready' && !a.releasing).map((a) => a.uploadId!),
      busy: attachments.some((a) => a.status !== 'ready' || a.releasing),
    });
  }, [attachments, onChange]);

  // 閉じる・アンマウント時は、進行中のアップロードを中断してプレビューURLを解放する。
  useEffect(() => {
    // StrictModeではEffectが「実行→後始末→再実行」されるため、開始時に毎回戻す。
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const attachment of live.current) {
        attachment.controller.abort();
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  const update = (localId: number, patch: Partial<Attachment>) =>
    setAttachments((current) => current.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));

  const start = (attachment: Attachment) => {
    void uploader
      .upload({
        draftId,
        file: attachment.file,
        signal: attachment.controller.signal,
        onStage: (stage) => update(attachment.localId, { status: stage }),
      })
      .then((result) => {
        if (attachment.controller.signal.aborted) {
          if (!mounted.current) {
            // 閉じた後は下書きごと破棄されるため、送るだけでよい。
            if (result.uploadId) void uploader.discardUpload(result.uploadId, draftId);
            return;
          }
          if (removing.current.delete(attachment.localId)) void finishRemoval(attachment, result.uploadId);
          return;
        }
        update(
          attachment.localId,
          result.ok
            ? { status: 'ready', uploadId: result.uploadId, error: undefined }
            : { status: 'error', uploadId: result.uploadId, error: result.message },
        );
      });
  };

  const add = (files: File[]) => {
    setSelectionError(null);
    const room = maxImages - live.current.length;
    if (files.length > room) setSelectionError(`画像は${MAX_IMAGES_PER_TWEET}枚まで添付できます`);
    const added: Attachment[] = [];
    for (const file of files.slice(0, Math.max(room, 0))) {
      const [error] = validateImageFile({ size: file.size, contentType: file.type });
      if (error) {
        setSelectionError(error);
        continue;
      }
      added.push({
        localId: ++seq.current,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'uploading',
        controller: new AbortController(),
      });
    }
    if (added.length === 0) return;
    setAttachments((current) => [...current, ...added]);
    added.forEach(start);
  };

  /**
   * 予約を破棄する。破棄に失敗したら予約IDを保ったまま案内を出し、falseを返す
   * （元のIDを失うと、その予約をもう解放できず4枚の枠が埋まったままになるため）。
   */
  const release = async (attachment: Attachment): Promise<boolean> => {
    if (!attachment.uploadId) return true;
    update(attachment.localId, { releasing: true, notice: undefined });
    const released = await uploader.discardUpload(attachment.uploadId, draftId);
    update(attachment.localId, released ? { releasing: false } : { releasing: false, notice: RELEASE_FAILED });
    return released;
  };

  const drop = (attachment: Attachment) => {
    URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((current) => current.filter((a) => a.localId !== attachment.localId));
  };

  /** アップロード中に解除した画像は、中断の結果で予約IDが分かってから破棄する。 */
  const finishRemoval = async (attachment: Attachment, uploadId: string | undefined) => {
    if (!uploadId) return drop(attachment);
    const pending = { ...attachment, uploadId, controller: new AbortController() };
    update(attachment.localId, { uploadId, controller: pending.controller });
    if (await release(pending)) return drop(attachment);
    // 破棄できなければ予約IDを保ち、もう一度解除できる状態にする。
    update(attachment.localId, { status: 'error', error: '中断しました' });
  };

  const remove = async (attachment: Attachment) => {
    if (attachment.status === 'uploading' || attachment.status === 'verifying') {
      removing.current.add(attachment.localId);
      update(attachment.localId, { releasing: true });
      attachment.controller.abort();
      return;
    }
    if (!(await release(attachment))) return;
    drop(attachment);
  };

  const retry = async (attachment: Attachment) => {
    // 予約は再利用しない。元の予約の破棄が成功してから、新しい予約・パスでアップロードし直す。
    if (!(await release(attachment))) return;
    const next = {
      ...attachment,
      status: 'uploading' as const,
      uploadId: undefined,
      error: undefined,
      notice: undefined,
      controller: new AbortController(),
    };
    update(attachment.localId, next);
    start(next);
  };

  const full = attachments.length >= maxImages;
  const messages = [...(selectionError ? [selectionError] : []), ...errors];

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {attachments.map((attachment, index) => (
            <li key={attachment.localId} className="relative overflow-hidden rounded-lg border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.previewUrl}
                alt={`添付画像${index + 1}`}
                className="h-28 w-full bg-gray-100 object-cover"
              />
              {attachment.notice && <p className="px-1 pt-1 text-xs text-red-600">{attachment.notice}</p>}
              <div className="flex flex-wrap items-center justify-between gap-1 p-1 text-xs">
                <span className={attachment.status === 'error' ? 'text-red-600' : 'text-gray-600'}>
                  {attachment.status === 'error'
                    ? attachment.error
                    : attachment.status === 'ready'
                      ? '添付済み'
                      : STATUS_LABEL[attachment.status]}
                </span>
                <span className="flex gap-1">
                  {attachment.status === 'error' && (
                    <button
                      type="button"
                      onClick={() => void retry(attachment)}
                      disabled={disabled || attachment.releasing}
                      aria-label={`画像${index + 1}を再試行`}
                      className="rounded border border-gray-300 px-2 py-0.5"
                    >
                      再試行
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(attachment)}
                    disabled={disabled || attachment.releasing}
                    aria-label={`画像${index + 1}を削除`}
                    className="rounded border border-gray-300 px-2 py-0.5"
                  >
                    削除
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-sky-500 px-4 py-1.5 text-sm font-bold text-sky-600 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        画像を追加
        <input
          type="file"
          accept="image/jpeg,image/png"
          multiple
          disabled={disabled || full}
          className="sr-only"
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </label>
      {messages.length > 0 && (
        <ul id="tweet-images-error" className="text-sm text-red-600">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
