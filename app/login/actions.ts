'use server';

import { CredentialsSignin } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/app/_auth/auth';
import { classifySignInResult, readStringFields, type SignInOutcome } from '@/app/lib/form-data';
import { validateLoginInput, type LoginFieldErrors } from '@/domain/users/login-validation';
import type { LoginErrorCode, LoginFormState } from './form-state';

const MESSAGES = {
  INVALID_REQUEST: '入力内容を確認して、もう一度お試しください',
  INVALID_CREDENTIALS: 'ユーザーIDまたはパスワードが違います',
  UNAVAILABLE: 'ログインできませんでした。時間をおいて再度お試しください',
} as const;

export async function loginAction(
  previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const attempt = previous.status === 'error' ? previous.attempt + 1 : 1;
  const failure = (
    code: LoginErrorCode,
    message: string,
    displayId: string,
    fieldErrors: LoginFieldErrors = {},
  ): LoginFormState => ({ status: 'error', code, message, fieldErrors, displayId, attempt });

  const fields = readStringFields(formData, ['displayId', 'password']);
  if (!fields) {
    const displayId = formData.get('displayId');
    return failure(
      'INVALID_INPUT',
      MESSAGES.INVALID_REQUEST,
      typeof displayId === 'string' ? displayId : '',
    );
  }

  const validation = validateLoginInput(fields);
  if (!validation.ok) {
    return failure('INVALID_INPUT', '', fields.displayId, validation.fieldErrors);
  }

  let outcome: SignInOutcome;
  try {
    outcome = classifySignInResult(
      await signIn('credentials', {
        displayId: fields.displayId,
        password: fields.password,
        redirect: false,
      }),
    );
  } catch (error) {
    outcome = error instanceof CredentialsSignin ? 'invalid-credentials' : 'unavailable';
  }
  if (outcome === 'invalid-credentials') {
    return failure('INVALID_CREDENTIALS', MESSAGES.INVALID_CREDENTIALS, fields.displayId);
  }
  if (outcome === 'unavailable') {
    return failure('UNAVAILABLE', MESSAGES.UNAVAILABLE, fields.displayId);
  }

  // redirectは例外で遷移するため、try/catchの外で呼ぶ。遷移先はクライアントから受け取らない。
  redirect('/');
}
