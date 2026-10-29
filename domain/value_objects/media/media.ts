import type { AllowedImageType } from '@/domain/value_objects/tweets/tweet-validation';

export type UploadStatus = 'reserved' | 'verified' | 'attached' | 'discarded' | 'deleting';

/** サーバーで実体から測った画像の情報。クライアント申告の値は使わない。 */
export type VerifiedImage = {
  size: number;
  contentType: AllowedImageType;
  width: number;
  height: number;
};

/** 投稿に表示する画像。 */
export type PublishedImage = { id: string; position: number; width: number; height: number };

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;
/** これより古い管理パス配下のBlobで、DBから参照されていないものを孤立として回収する。 */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_PREFIX = 'tweet-uploads/';

/** 画像のパスはサーバーだけが生成する。元のファイル名は使わない。 */
export function uploadPathname(draftId: string, uploadId: string): string {
  return `${UPLOAD_PREFIX}${draftId}/${uploadId}`;
}
