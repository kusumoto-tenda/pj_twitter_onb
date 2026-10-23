import type { LoginFieldErrors } from '@/domain/users/login-validation';

export type LoginErrorCode = 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'UNAVAILABLE';

export type LoginFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      code: LoginErrorCode;
      /** フォーム全体のメッセージ。欄エラーだけの場合は空文字。 */
      message: string;
      fieldErrors: LoginFieldErrors;
      /** 失敗時に再表示するID。パスワードは保持しない。 */
      displayId: string;
      attempt: number;
    };

export const initialLoginState: LoginFormState = { status: 'idle' };
