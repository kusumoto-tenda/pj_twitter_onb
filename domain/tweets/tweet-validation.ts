import { countCharacters } from '@/domain/users/account-validation';

export const TWEET_CONTENT_MAX_LENGTH = 280;
export const MAX_IMAGES_PER_TWEET = 4;
/** 5MB = 5 * 1024 * 1024 バイト。上限ちょうどは許可する。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** デコード時の資源使用量を抑えるための画素数の上限。 */
export const MAX_IMAGE_PIXELS = 40_000_000;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TweetInput = { content: string; uploadIds: string[] };
export type ValidTweetInput = { content: string; uploadIds: string[] };
export type TweetFieldErrors = { content?: string[]; images?: string[] };

export type TweetValidation =
  | { ok: true; value: ValidTweetInput }
  | { ok: false; fieldErrors: TweetFieldErrors };

/** フォーム送信でCRLF・CRになる改行をLFに揃える。前後の空白は変えない。 */
export function normalizeTweetContent(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function isAllowedImageType(contentType: string): contentType is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType);
}

/**
 * 投稿内容を検証する。本文は改行だけを揃えて保持し、空白・改行だけの本文は「内容なし」と判定する。
 * 本文と画像の少なくとも一方が必要。画像は選択順を保つ。
 */
export function validateTweetInput(input: TweetInput): TweetValidation {
  const content = normalizeTweetContent(input.content);
  const uploadIds = [...input.uploadIds];
  const fieldErrors: TweetFieldErrors = {};

  if (countCharacters(content) > TWEET_CONTENT_MAX_LENGTH) {
    fieldErrors.content = [`本文は${TWEET_CONTENT_MAX_LENGTH}文字以下で入力してください`];
  } else if (content.trim() === '' && uploadIds.length === 0) {
    fieldErrors.content = ['本文か画像のどちらかを入力してください'];
  }

  if (uploadIds.length > MAX_IMAGES_PER_TWEET) {
    fieldErrors.images = [`画像は${MAX_IMAGES_PER_TWEET}枚まで添付できます`];
  } else if (
    uploadIds.some((uploadId) => !UUID_PATTERN.test(uploadId)) ||
    new Set(uploadIds.map((uploadId) => uploadId.toLowerCase())).size !== uploadIds.length
  ) {
    fieldErrors.images = ['添付画像を確認してください'];
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { content, uploadIds } };
}

/** 画像1枚のサイズと形式の業務上限。実体の形式はサーバーでのデコード結果で判断する。 */
export function validateImageFile({ size, contentType }: { size: number; contentType: string }): string[] {
  if (!isAllowedImageType(contentType)) return ['JPEG・PNG画像のみ添付できます'];
  if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    return ['画像は1枚5MB以下にしてください'];
  }
  return [];
}

export function validateImageDimensions({ width, height }: { width: number; height: number }): string[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return ['画像を読み込めませんでした'];
  }
  if (width * height > MAX_IMAGE_PIXELS) return ['画像の画素数が大きすぎます'];
  return [];
}
