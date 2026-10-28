import { normalizeUuid } from '@/domain/shared/uuid';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  validateImageFile,
} from '@/domain/tweets/tweet-validation';
import { UPLOAD_TOKEN_TTL_MS, uploadPathname } from './media';
import type { MediaRepository } from './ports/media-repository';
import type { MediaStorage } from './ports/media-storage';

export type ReserveImageUploadResult =
  | { ok: true; uploadId: string; pathname: string; token: string }
  | { ok: false; code: 'INVALID_IMAGE'; message: string }
  | {
      ok: false;
      code: 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'DRAFT_EXPIRED' | 'LIMIT_REACHED' | 'UNAVAILABLE';
    };

/**
 * 画像1枚分の予約を作り、そのパスだけに書き込める短命のトークンを発行する。
 * 申告されたサイズ・形式は早期に断るためだけに使い、最終判断は検証時に実体で行う。
 * 予約IDはクライアントが決めて送れる。応答を受け取れなくても、そのIDで予約を解放・再送できるようにするため。
 */
export async function reserveImageUpload(
  deps: {
    media: Pick<MediaRepository, 'reserveUpload' | 'discardUpload'>;
    storage: Pick<MediaStorage, 'createUploadToken'>;
    newId: () => string;
    now: () => Date;
  },
  input: { actorId: string | null; draftId: string; uploadId?: string; contentType: string; size: number },
): Promise<ReserveImageUploadResult> {
  if (input.actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  const [error] = validateImageFile({ size: input.size, contentType: input.contentType });
  if (error) return { ok: false, code: 'INVALID_IMAGE', message: error };

  const uploadId = input.uploadId === undefined ? deps.newId() : normalizeUuid(input.uploadId);
  if (uploadId === null) return { ok: false, code: 'INVALID_REQUEST' };

  const now = deps.now();
  const pathname = uploadPathname(input.draftId, uploadId);
  const tokenValidUntil = new Date(now.getTime() + UPLOAD_TOKEN_TTL_MS);
  try {
    const outcome = await deps.media.reserveUpload({
      actorId: input.actorId,
      draftId: input.draftId,
      uploadId,
      storageKey: pathname,
      tokenValidUntil,
      now,
    });
    switch (outcome) {
      case 'reserved':
        break;
      case 'forbidden':
        return { ok: false, code: 'FORBIDDEN' };
      case 'draft-not-found':
      case 'draft-closed':
        return { ok: false, code: 'DRAFT_EXPIRED' };
      case 'limit-reached':
        return { ok: false, code: 'LIMIT_REACHED' };
      case 'conflict':
        return { ok: false, code: 'INVALID_REQUEST' };
    }
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }

  try {
    const token = await deps.storage.createUploadToken({
      pathname,
      maximumSizeInBytes: MAX_IMAGE_BYTES,
      allowedContentTypes: ALLOWED_IMAGE_TYPES,
      validUntil: tokenValidUntil,
    });
    return { ok: true, uploadId, pathname, token };
  } catch {
    // トークンを渡せない予約は使われないため、枠を空けておく。解放に失敗しても下書きの期限切れで回収される。
    await deps.media.discardUpload({ actorId: input.actorId, uploadId, now }).catch(() => {});
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
