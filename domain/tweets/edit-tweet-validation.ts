import { countCharacters } from '@/domain/users/account-validation';
import {
  MAX_IMAGES_PER_TWEET,
  TWEET_CONTENT_MAX_LENGTH,
  normalizeTweetContent,
  type TweetFieldErrors,
} from './tweet-validation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EditTweetInput = {
  content: string;
  /** 残す既存画像（images.id）。元の順序のまま並べる。 */
  keepImageIds: string[];
  /** この編集用下書きで新しく追加する画像（media_uploads.id）。 */
  uploadIds: string[];
};
export type ValidEditTweetInput = EditTweetInput;

export type EditTweetValidation =
  | { ok: true; value: ValidEditTweetInput }
  | { ok: false; fieldErrors: TweetFieldErrors };

/**
 * 編集内容を検証する。本文は改行だけを揃えて保持し、画像は「保持する既存画像＋新規画像」で4枚まで。
 * UUIDは小文字に揃え、順序は保つ。本文と画像の少なくとも一方が必要。
 */
export function validateEditTweetInput(input: EditTweetInput): EditTweetValidation {
  const content = normalizeTweetContent(input.content);
  const keepImageIds = input.keepImageIds.map((id) => id.toLowerCase());
  const uploadIds = input.uploadIds.map((id) => id.toLowerCase());
  const all = [...keepImageIds, ...uploadIds];
  const fieldErrors: TweetFieldErrors = {};

  if (countCharacters(content) > TWEET_CONTENT_MAX_LENGTH) {
    fieldErrors.content = [`本文は${TWEET_CONTENT_MAX_LENGTH}文字以下で入力してください`];
  } else if (content.trim() === '' && all.length === 0) {
    fieldErrors.content = ['本文か画像のどちらかを入力してください'];
  }

  if (all.length > MAX_IMAGES_PER_TWEET) {
    fieldErrors.images = [`画像は${MAX_IMAGES_PER_TWEET}枚まで添付できます`];
  } else if (all.some((id) => !UUID_PATTERN.test(id)) || new Set(all).size !== all.length) {
    fieldErrors.images = ['添付画像を確認してください'];
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { content, keepImageIds, uploadIds } };
}
