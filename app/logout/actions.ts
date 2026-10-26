'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/_auth/auth';
import { getSessionDependencies } from '@/app/_composition/session';
import { readStringFields } from '@/app/lib/form-data';
import {
  FLASH_MAX_AGE_SECONDS,
  LOGGED_OUT_COOKIE,
  LOGGED_OUT_FLASH,
  LOGOUT_FAILED_MESSAGE,
} from '@/app/ui/notifications/flash';
import { logout } from '@/application/auth/logout';
import { normalizeUuid } from '@/domain/shared/uuid';
import type { LogoutErrorCode, LogoutFormState } from './form-state';

/** 現在の認証セッションだけを確認し、利用者DBの実在確認をログアウトの前提にしない。 */
export async function logoutAction(previous: LogoutFormState, formData: FormData): Promise<LogoutFormState> {
  const attempt = previous.status === 'error' ? previous.attempt + 1 : 1;
  const failure = (code: LogoutErrorCode): LogoutFormState => ({
    status: 'error', code, attempt,
    message: code === 'SESSION_CHANGED'
      ? 'ログイン中の利用者が変わりました。画面を開き直してください'
      : LOGOUT_FAILED_MESSAGE,
  });

  const fields = readStringFields(formData, ['expectedActorId']);
  const expectedActorId = fields && normalizeUuid(fields.expectedActorId);
  if (!expectedActorId) return failure('INVALID_REQUEST');

  try {
    // auth()の障害と匿名を区別し、障害時にセッションを終了しない。
    const session = await auth();
    const sessionId = session?.user?.id || null;
    const actorId = sessionId === null ? null : normalizeUuid(sessionId);
    if (sessionId !== null && actorId === null) return failure('UNAVAILABLE');

    const result = await logout(getSessionDependencies(), { actorId, expectedActorId });
    if (!result.ok) return failure(result.code);
  } catch {
    return failure('UNAVAILABLE');
  }

  revalidatePath('/', 'layout');
  (await cookies()).set(LOGGED_OUT_COOKIE, LOGGED_OUT_FLASH, {
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // 表示専用。既存の通知と同じくClientで一度読み取って削除する。
    httpOnly: false,
  });
  // redirectは例外を投げるためcatchの外で実行する。遷移先は入力から受け取らない。
  redirect('/login');
}
