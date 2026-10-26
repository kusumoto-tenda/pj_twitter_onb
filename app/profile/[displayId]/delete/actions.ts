'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/app/_auth/auth';
import { getAccountDependencies } from '@/app/_composition/account';
import { isSuccessfulSignOut, readStringFields } from '@/app/lib/form-data';
import {
  ACCOUNT_DELETED_COOKIE,
  FLASH_MAX_AGE_SECONDS,
  type AccountDeletedFlash,
} from '@/app/ui/notifications/flash';
import { deleteAccount } from '@/application/users/delete-account';
import type { AccountDeleteErrorCode, AccountDeleteFormState } from './form-state';

const MESSAGES = {
  INVALID_REQUEST: '入力内容を確認して、もう一度お試しください',
  FORBIDDEN: 'このアカウントは削除できません',
  UNAVAILABLE: '削除できませんでした。時間をおいて再度お試しください',
} as const;

/** Auth.jsで現在の認証Cookieを無効化する。失敗してもthrowせず、結果だけを返す。 */
async function endSession(): Promise<boolean> {
  try {
    // signOut(redirect: false) は遷移先URLを含む結果を返す。エラーを示すURLや想定外の値は失敗とする。
    return isSuccessfulSignOut(await signOut({ redirect: false }));
  } catch {
    return false;
  }
}

/**
 * 削除済み（または対象なし）のアカウントの後処理。表示を無効化し、ログアウトしてログイン画面へ移動する。
 * DB削除とCookieの変更は1つのトランザクションにできないため、signOutの失敗では削除を戻さない。
 */
async function finishWithoutAccount(outcome: 'deleted' | 'missing'): Promise<never> {
  revalidatePath('/');
  revalidatePath('/profile/[displayId]', 'page');
  revalidatePath('/profile/[displayId]/edit', 'page');
  revalidatePath('/profile/[displayId]/delete', 'page');
  revalidatePath('/favorites');
  const signedOut = await endSession();
  const flash: AccountDeletedFlash =
    outcome === 'missing' ? 'account-missing' : signedOut ? 'deleted' : 'signout-failed';
  (await cookies()).set(ACCOUNT_DELETED_COOKIE, flash, {
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // 表示専用。Client Componentが読み取った直後に削除する。
    httpOnly: false,
  });
  // redirectは例外で遷移するため、try/catchの外で呼ぶ。遷移先は固定。
  redirect('/login');
}

/**
 * アカウントを削除する。targetIdは削除画面の表示時にbindした対象のUUID。
 * bind値・hidden値・previousStateは権限判断に使わず、呼ばれるたびにセッションを確認する。
 * 同時削除でもう利用者がいない場合も旧セッションを後処理できるよう、ここではセッションのUUIDだけを取り、
 * アカウントの存在とパスワードはユースケースで確認する。
 */
export async function deleteAccountAction(
  targetId: string,
  previous: AccountDeleteFormState,
  formData: FormData,
): Promise<AccountDeleteFormState> {
  const attempt = previous.status === 'error' ? previous.attempt + 1 : 1;
  const failure = (
    code: AccountDeleteErrorCode,
    message: string,
    fieldErrors: { password?: string[] } = {},
  ): AccountDeleteFormState => ({ status: 'error', code, message, fieldErrors, attempt });

  const fields = readStringFields(formData, ['password']);
  if (!fields) return failure('INVALID_REQUEST', MESSAGES.INVALID_REQUEST);

  const session = await auth();
  const actorId = session?.user?.id || null;
  if (!actorId) redirect('/login');

  const { users, passwords } = getAccountDependencies();
  const result = await deleteAccount({ users, passwords }, { actorId, targetId, password: fields.password });
  if (result.ok) return finishWithoutAccount('deleted');

  switch (result.code) {
    case 'UNAUTHENTICATED':
      redirect('/login');
    case 'NOT_FOUND':
      // 本人確認（actorId === targetId）は済んでいる。対象がもうないので、旧セッションを片付ける。
      return finishWithoutAccount('missing');
    case 'INVALID_INPUT':
      return failure(result.code, '', result.fieldErrors);
    case 'INVALID_PASSWORD':
      return failure(result.code, '', { password: ['パスワードが違います'] });
    case 'FORBIDDEN':
    case 'UNAVAILABLE':
      return failure(result.code, MESSAGES[result.code]);
  }
}
