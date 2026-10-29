'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { signIn } from '@/app/_auth/auth';
import { getAccountDependencies } from '@/main/container/account';
import { isSuccessfulSignIn } from '@/app/lib/form-data';
import {
  ACCOUNT_CREATED_FLASH,
  FLASH_COOKIE,
  FLASH_MAX_AGE_SECONDS,
} from '@/app/ui/notifications/flash';
import { createAccount } from '@/application/usecases/users/create-account';
import type { FieldErrors } from '@/domain/entities/users/user';
import type {
  CreateAccountErrorCode,
  CreateAccountFormState,
  CreateAccountFormValues,
} from './form-state';
import { parseCreateAccountForm } from './parse-form';

function failure(
  previous: CreateAccountFormState,
  code: CreateAccountErrorCode,
  values: CreateAccountFormValues,
  fieldErrors: FieldErrors = {},
): CreateAccountFormState {
  const attempt = previous.status === 'error' ? previous.attempt + 1 : 1;
  return { status: 'error', code, fieldErrors, values, attempt };
}

function valuesFrom(formData: FormData): CreateAccountFormValues {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : '';
  };
  return { name: text('name'), displayId: text('displayId') };
}

export async function createAccountAction(
  previous: CreateAccountFormState,
  formData: FormData,
): Promise<CreateAccountFormState> {
  const values = valuesFrom(formData);
  const parsed = parseCreateAccountForm(formData);
  if (!parsed.ok) return failure(previous, 'INVALID_REQUEST', values);

  const result = await createAccount(getAccountDependencies(), parsed.input);
  if (!result.ok) {
    switch (result.code) {
      case 'INVALID_INPUT':
        return failure(previous, result.code, values, result.fieldErrors);
      case 'DISPLAY_ID_TAKEN':
        return failure(previous, result.code, values, {
          displayId: ['このユーザーIDは既に使われています'],
        });
      default:
        return failure(previous, result.code, values);
    }
  }

  // DB保存と認証Cookieの発行は同一トランザクションにできない。
  // 失敗時もユーザーは削除せず、ログイン画面へ案内する。
  let signedIn = false;
  try {
    signedIn = isSuccessfulSignIn(
      await signIn('credentials', {
        displayId: parsed.input.displayId,
        password: parsed.input.password,
        redirect: false,
      }),
    );
  } catch {
    signedIn = false;
  }
  if (!signedIn) return failure(previous, 'ACCOUNT_CREATED_SESSION_FAILED', values);

  (await cookies()).set(FLASH_COOKIE, ACCOUNT_CREATED_FLASH, {
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // 表示専用。Client Componentが読み取った直後に削除する。
    httpOnly: false,
  });
  // redirectは例外で遷移するため、try/catchの外で呼ぶ。
  redirect('/');
}
