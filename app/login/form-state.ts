export type LoginFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string; displayId: string; attempt: number };

export const initialLoginState: LoginFormState = { status: 'idle' };
