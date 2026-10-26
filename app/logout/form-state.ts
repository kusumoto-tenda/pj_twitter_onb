export type LogoutErrorCode = 'INVALID_REQUEST' | 'SESSION_CHANGED' | 'UNAVAILABLE';

export type LogoutFormState =
  | { status: 'idle' }
  | { status: 'error'; code: LogoutErrorCode; message: string; attempt: number };

export const initialLogoutState: LogoutFormState = { status: 'idle' };
