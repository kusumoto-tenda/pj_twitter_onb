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
  /** 予約を破棄する。解放できた（予約がもう無い場合を含む）ときだけtrue。 */
  discardUpload(uploadId: string, draftId: string): Promise<boolean>;
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
  return { ok: response.ok, status: response.status, json };
}

/**
 * 予約→Vercel Blobへの直接アップロード→サーバーでの検証、の順に行う。
 * 画像の本体はアプリのサーバーを通らず、予約パス限定の短命トークンでBlobへ送る。
 */
export const blobImageUploader: ImageUploader = {
  async upload({ draftId, file, signal, onStage }) {
    // 予約IDは先に決めて送る。予約の応答を失っても（サーバーでは予約済みかもしれない）、
    // 呼び出し側がこのIDで予約を解放できるよう、通信の失敗・中断では必ずuploadIdを返す。
    const uploadId = crypto.randomUUID();
    try {
      const reserved = await postJson(
        '/api/tweet-images/upload',
        { draftId, uploadId, contentType: file.type, size: file.size },
        { signal },
      );
      if (!reserved.ok) {
        const message = String(reserved.json.message ?? GENERIC_ERROR);
        // 4xxは予約前に断られたもの。5xxは予約後に失敗し、予約が残っている可能性がある。
        return reserved.status >= 500 ? { ok: false, uploadId, message } : { ok: false, message };
      }
      const body = reserved.json as { pathname: string; token: string };

      onStage('uploading');
      await put(body.pathname, file, { access: 'private', token: body.token, contentType: file.type, abortSignal: signal });

      onStage('verifying');
      const verified = await postJson('/api/tweet-images/verify', { uploadId }, { signal });
      if (!verified.ok) return { ok: false, uploadId, message: String(verified.json.message ?? GENERIC_ERROR) };
      return { ok: true, uploadId };
    } catch {
      return { ok: false, uploadId, message: GENERIC_ERROR };
    }
  },
  async discardUpload(uploadId, draftId) {
    try {
      // ページ遷移中でも届くようkeepaliveで送る。
      const response = await fetch('/api/tweet-images/discard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 予約より先に届いた場合でも、後から届く予約を拒否できるよう下書きを添える。
        body: JSON.stringify({ uploadId, draftId }),
        keepalive: true,
      });
      // 404は予約がもう無い（解放済み）ことを示す。それ以外の失敗では予約が残っている可能性がある。
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  },
  discardDraft(draftId) {
    void postJson('/api/tweet-images/discard', { draftId }, { keepalive: true }).catch(() => {});
  },
};
