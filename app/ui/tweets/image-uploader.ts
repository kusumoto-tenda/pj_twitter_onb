'use client';

import { put } from '@vercel/blob/client';

export type UploadStage = 'uploading' | 'verifying';

export type UploadResult =
  | { ok: true; uploadId: string }
  | { ok: false; message: string; uploadId?: string };

/** 画像のアップロードと破棄。ダイアログからはこのインターフェースだけを使う（テストでは差し替える）。 */
export interface ImageUploader {
  upload(input: {
    draftId: string;
    file: File;
    signal: AbortSignal;
    onStage: (stage: UploadStage) => void;
  }): Promise<UploadResult>;
  discardUpload(uploadId: string): void;
  discardDraft(draftId: string): void;
}

const GENERIC_ERROR = '画像をアップロードできませんでした。再試行してください';

async function postJson(path: string, body: unknown, init: RequestInit = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, json };
}

/**
 * 予約→Vercel Blobへの直接アップロード→サーバーでの検証、の順に行う。
 * 画像の本体はアプリのサーバーを通らず、予約パス限定の短命トークンでBlobへ送る。
 */
export const blobImageUploader: ImageUploader = {
  async upload({ draftId, file, signal, onStage }) {
    try {
      const reserved = await postJson(
        '/api/tweet-images/upload',
        { draftId, contentType: file.type, size: file.size },
        { signal },
      );
      if (!reserved.ok) return { ok: false, message: String(reserved.json.message ?? GENERIC_ERROR) };
      const { uploadId, pathname, token } = reserved.json as { uploadId: string; pathname: string; token: string };

      onStage('uploading');
      await put(pathname, file, { access: 'private', token, contentType: file.type, abortSignal: signal });

      onStage('verifying');
      const verified = await postJson('/api/tweet-images/verify', { uploadId }, { signal });
      if (!verified.ok) return { ok: false, uploadId, message: String(verified.json.message ?? GENERIC_ERROR) };
      return { ok: true, uploadId };
    } catch {
      return { ok: false, message: GENERIC_ERROR };
    }
  },
  discardUpload(uploadId) {
    // ページ遷移中でも届くようkeepaliveで送る。失敗しても期限切れの回収で消える。
    void postJson('/api/tweet-images/discard', { uploadId }, { keepalive: true }).catch(() => {});
  },
  discardDraft(draftId) {
    void postJson('/api/tweet-images/discard', { draftId }, { keepalive: true }).catch(() => {});
  },
};
