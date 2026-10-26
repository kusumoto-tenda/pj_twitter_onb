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
      code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'DRAFT_EXPIRED' | 'LIMIT_REACHED' | 'UNAVAILABLE';
    };

/**
 * 画像1枚分の予約を作り、そのパスだけに書き込める短命のトークンを発行する。
 * 申告されたサイズ・形式は早期に断るためだけに使い、最終判断は検証時に実体で行う。
 */
export async function reserveImageUpload(
  deps: {
    media: Pick<MediaRepository, 'reserveUpload'>;
    storage: Pick<MediaStorage, 'createUploadToken'>;
    newId: () => string;
    now: () => Date;
  },
  input: { actorId: string | null; draftId: string; contentType: string; size: number },
): Promise<ReserveImageUploadResult> {
  if (input.actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  const [error] = validateImageFile({ size: input.size, contentType: input.contentType });
  if (error) return { ok: false, code: 'INVALID_IMAGE', message: error };

  const now = deps.now();
  const uploadId = deps.newId();
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
    }
    const token = await deps.storage.createUploadToken({
      pathname,
      maximumSizeInBytes: MAX_IMAGE_BYTES,
      allowedContentTypes: ALLOWED_IMAGE_TYPES,
      validUntil: tokenValidUntil,
    });
    return { ok: true, uploadId, pathname, token };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
