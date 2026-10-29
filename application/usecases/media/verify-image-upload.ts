import {
  MAX_IMAGE_BYTES,
  isAllowedImageType,
  validateImageDimensions,
  validateImageFile,
} from '@/domain/value_objects/tweets/tweet-validation';
import type { ImageInspector } from '@/domain/external_service_ifs/media/image-inspector';
import type { MediaRepository } from '@/domain/repository_ifs/media-repository';
import type { MediaStorage } from '@/domain/external_service_ifs/media/media-storage';

export type VerifyImageUploadResult =
  | { ok: true; upload: { id: string; width: number; height: number } }
  | { ok: false; code: 'INVALID_IMAGE'; message: string }
  | { ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'NOT_UPLOADED' | 'UNAVAILABLE' };

const FORMAT_TO_TYPE: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png' };
const INVALID_FORMAT = 'JPEG・PNG画像のみ添付できます';

/** 上限を超えた時点で読み取りを止める。超えたらnull。 */
async function readWithLimit(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * アップロードされた実体を検証してverifiedにする。取得先はサーバーが保存したパスだけで、
 * クライアント申告のサイズ・形式・URLは使わない。メタデータだけで判断せず、実体をデコードする。
 */
export async function verifyImageUpload(
  deps: {
    media: Pick<MediaRepository, 'findOwnedUpload' | 'markVerified'>;
    storage: Pick<MediaStorage, 'inspect' | 'open'>;
    inspector: ImageInspector;
    now: () => Date;
  },
  { actorId, uploadId }: { actorId: string | null; uploadId: string },
): Promise<VerifyImageUploadResult> {
  if (actorId === null) return { ok: false, code: 'FORBIDDEN' };
  const invalid = (message: string): VerifyImageUploadResult => ({ ok: false, code: 'INVALID_IMAGE', message });

  try {
    const found = await deps.media.findOwnedUpload({ actorId, uploadId, now: deps.now() });
    if (found.status === 'forbidden') return { ok: false, code: 'FORBIDDEN' };
    if (found.status !== 'found' || found.upload.status !== 'reserved') return { ok: false, code: 'NOT_FOUND' };
    const { storageKey } = found.upload;

    const meta = await deps.storage.inspect(storageKey);
    if (!meta) return { ok: false, code: 'NOT_UPLOADED' };
    const [metaError] = validateImageFile(meta);
    if (metaError) return invalid(metaError);

    const stream = await deps.storage.open(storageKey);
    if (!stream) return { ok: false, code: 'NOT_UPLOADED' };
    const bytes = await readWithLimit(stream, MAX_IMAGE_BYTES);
    if (!bytes) return invalid('画像は1枚5MB以下にしてください');

    const decoded = await deps.inspector.inspect(bytes);
    const contentType = decoded ? FORMAT_TO_TYPE[decoded.format] : undefined;
    // 実体の形式とアップロード時のContent-Typeが一致しなければ偽装として扱う。
    if (!decoded || !contentType || contentType !== meta.contentType || !isAllowedImageType(contentType)) {
      return invalid(INVALID_FORMAT);
    }
    const [dimensionError] = validateImageDimensions(decoded);
    if (dimensionError) return invalid(dimensionError);

    const marked = await deps.media.markVerified({
      actorId,
      uploadId,
      image: { size: bytes.byteLength, contentType, width: decoded.width, height: decoded.height },
      now: deps.now(),
    });
    if (marked !== 'verified') return { ok: false, code: 'NOT_FOUND' };
    return { ok: true, upload: { id: uploadId, width: decoded.width, height: decoded.height } };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
