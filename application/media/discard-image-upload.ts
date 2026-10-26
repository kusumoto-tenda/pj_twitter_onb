import type { MediaRepository } from './ports/media-repository';

export type DiscardImageUploadResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'ATTACHED' | 'UNAVAILABLE' };

/** 添付の解除。本人の未投稿の画像だけを破棄し、実体は後で回収する。 */
export async function discardImageUpload(
  deps: { media: Pick<MediaRepository, 'discardUpload'>; now: () => Date },
  { actorId, uploadId }: { actorId: string | null; uploadId: string },
): Promise<DiscardImageUploadResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  try {
    const outcome = await deps.media.discardUpload({ actorId, uploadId, now: deps.now() });
    switch (outcome) {
      case 'discarded':
        return { ok: true };
      case 'forbidden':
        return { ok: false, code: 'FORBIDDEN' };
      case 'not-found':
        return { ok: false, code: 'NOT_FOUND' };
      case 'attached':
        return { ok: false, code: 'ATTACHED' };
    }
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
