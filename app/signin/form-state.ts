import type { FieldErrors } from '@/domain/users/user';

/** 失敗時に再表示する入力値。パスワードは含めない。 */
export type CreateAccountFormValues = { name: string; displayId: string; bio: string };

export type CreateAccountErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_INPUT'
  | 'DISPLAY_ID_TAKEN'
  | 'UNAVAILABLE'
  | 'ACCOUNT_CREATED_SESSION_FAILED';

export type CreateAccountFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      code: CreateAccountErrorCode;
      fieldErrors: FieldErrors;
      values: CreateAccountFormValues;
      /** 失敗のたびに増え、同じエラーの再送でも通知を再表示するために使う。 */
      attempt: number;
    };

export const initialCreateAccountState: CreateAccountFormState = { status: 'idle' };
