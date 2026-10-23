import type { EditProfileFieldErrors } from '@/domain/users/profile-edit-validation';

/** 失敗時に再表示する入力値。 */
export type ProfileEditFormValues = { name: string; displayId: string; bio: string };

export type ProfileEditErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_INPUT'
  | 'DISPLAY_ID_TAKEN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'UNAVAILABLE';

export type ProfileEditFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      code: ProfileEditErrorCode;
      /** フォーム全体のメッセージ。欄エラーだけの場合は空文字。 */
      message: string;
      fieldErrors: EditProfileFieldErrors;
      values: ProfileEditFormValues;
      /** 失敗のたびに増え、フォームを再マウントして入力値を反映する。 */
      attempt: number;
    };

export const initialProfileEditState: ProfileEditFormState = { status: 'idle' };
