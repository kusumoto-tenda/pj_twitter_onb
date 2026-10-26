import type { TweetFieldErrors } from '@/domain/tweets/tweet-validation';

export type EditTweetErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'DRAFT_EXPIRED'
  | 'CONFLICT'
  | 'UPLOAD_NOT_READY'
  | 'UNAVAILABLE'
  /** Action呼び出し自体の失敗（ダイアログ側で作る。サーバーからは返さない）。 */
  | 'NETWORK_ERROR';

/** 本文や画像は返さない（ダイアログ側で保持する）。成功しても画面は移動しない。 */
export type EditTweetFormState =
  | { status: 'idle' }
  | { status: 'success'; tweetId: string; attempt: number }
  | {
      status: 'error';
      code: EditTweetErrorCode;
      /** フォーム全体のメッセージ。欄エラーだけの場合は空文字。 */
      message: string;
      fieldErrors: TweetFieldErrors;
      /** 送信のたびに増え、同じ結果でも通知を再表示する。 */
      attempt: number;
    };

export const initialEditTweetState: EditTweetFormState = { status: 'idle' };
