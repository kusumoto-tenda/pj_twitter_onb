import type { TweetFieldErrors } from '@/domain/tweets/tweet-validation';

export type CreateTweetErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'DRAFT_EXPIRED'
  | 'UPLOAD_NOT_READY'
  | 'CONFLICT'
  | 'UNAVAILABLE';

/** 本文や画像は返さない（ダイアログ側で保持する）。 */
export type CreateTweetFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      code: CreateTweetErrorCode;
      /** フォーム全体のメッセージ。欄エラーだけの場合は空文字。 */
      message: string;
      fieldErrors: TweetFieldErrors;
      /** 失敗のたびに増え、同じエラーでも失敗の通知を再表示する。 */
      attempt: number;
    };

export const initialCreateTweetState: CreateTweetFormState = { status: 'idle' };
