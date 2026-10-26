export type AccountDeleteErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_INPUT'
  | 'INVALID_PASSWORD'
  | 'FORBIDDEN'
  | 'UNAVAILABLE';

/** パスワード・ハッシュ・対象や操作者のUUIDは含めない。 */
export type AccountDeleteFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      code: AccountDeleteErrorCode;
      /** フォーム全体のメッセージ。欄エラーだけの場合は空文字。 */
      message: string;
      fieldErrors: { password?: string[] };
      /** 失敗のたびに増え、フォームを再マウントしてパスワードを空にする。 */
      attempt: number;
    };

export const initialAccountDeleteState: AccountDeleteFormState = { status: 'idle' };
