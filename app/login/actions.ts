'use server';

import { CredentialsSignin } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/app/_auth/auth';
import { isSuccessfulSignIn, readStringFields } from '@/app/lib/form-data';
import type { LoginFormState } from './form-state';

const INVALID_CREDENTIALS = 'ユーザーIDまたはパスワードが違います';
const UNAVAILABLE = 'ログインできませんでした。時間をおいて再度お試しください';

export async function loginAction(
  previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const attempt = previous.status === 'error' ? previous.attempt + 1 : 1;
  const fields = readStringFields(formData, ['displayId', 'password']);
  if (!fields) {
    return { status: 'error', message: INVALID_CREDENTIALS, displayId: '', attempt };
  }

  let message: string | null = null;
  try {
    const result = await signIn('credentials', {
      displayId: fields.displayId,
      password: fields.password,
      redirect: false,
    });
    if (!isSuccessfulSignIn(result)) message = INVALID_CREDENTIALS;
  } catch (error) {
    message = error instanceof CredentialsSignin ? INVALID_CREDENTIALS : UNAVAILABLE;
  }
  if (message) return { status: 'error', message, displayId: fields.displayId, attempt };

  redirect('/');
}
