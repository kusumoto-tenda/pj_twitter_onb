export type DeleteTweetFailureCode = 'INVALID_REQUEST' | 'SESSION_CHANGED' | 'FORBIDDEN' | 'UNAVAILABLE';

/** 成功しても画面は移動しない。既にない投稿（not-found）は削除成功と区別して知らせる。 */
export type DeleteTweetFormState =
  | { status: 'idle' }
  | { status: 'success'; attempt: number }
  | { status: 'not-found'; message: string; attempt: number }
  | {
      status: 'error';
      code: DeleteTweetFailureCode;
      message: string;
      /** 送信のたびに増え、同じ結果でも通知を再表示する。 */
      attempt: number;
    };

export const initialDeleteTweetState: DeleteTweetFormState = { status: 'idle' };
