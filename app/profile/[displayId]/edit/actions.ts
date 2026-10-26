'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveViewer } from '@/app/_auth/viewer';
import { getAccountDependencies } from '@/app/_composition/account';
import { profileHref } from '@/app/lib/profile-query';
import {
  FLASH_MAX_AGE_SECONDS,
  PROFILE_UPDATED_COOKIE,
  PROFILE_UPDATED_FLASH,
} from '@/app/ui/notifications/flash';
import { updateProfile } from '@/application/users/update-profile';
import type { EditProfileFieldErrors } from '@/domain/users/profile-edit-validation';
import type {
  ProfileEditErrorCode,
  ProfileEditFormState,
  ProfileEditFormValues,
} from './form-state';
import { parseProfileEditForm } from './parse-form';

const MESSAGES = {
  INVALID_REQUEST: '入力内容を確認して、もう一度お試しください',
  FORBIDDEN: 'このプロフィールは編集できません',
  NOT_FOUND: 'アカウントを確認できません。再度ログインしてください',
  UNAVAILABLE: '保存できませんでした。時間をおいて再度お試しください',
} as const;

function valuesFrom(formData: FormData): ProfileEditFormValues {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : '';
  };
  return { name: text('name'), displayId: text('displayId'), bio: text('bio') };
}

/**
 * プロフィールを保存する。targetIdは編集画面の表示時にbindした対象のUUID。
 * bind値・hidden値・previousStateは権限判断に使わず、呼ばれるたびにサーバーで閲覧者を確認する。
 */
export async function updateProfileAction(
  targetId: string,
  previous: ProfileEditFormState,
  formData: FormData,
): Promise<ProfileEditFormState> {
  const attempt = previous.status === 'error' ? previous.attempt + 1 : 1;
  const values = valuesFrom(formData);
  const failure = (
    code: ProfileEditErrorCode,
    message: string,
    fieldErrors: EditProfileFieldErrors = {},
  ): ProfileEditFormState => ({ status: 'error', code, message, fieldErrors, values, attempt });

  const parsed = parseProfileEditForm(formData);
  if (!parsed.ok) return failure('INVALID_REQUEST', MESSAGES.INVALID_REQUEST);

  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return failure('UNAVAILABLE', MESSAGES.UNAVAILABLE);
  if (viewer.status === 'anonymous') redirect('/login');

  const result = await updateProfile(
    { users: getAccountDependencies().users },
    { actorId: viewer.profile.id, targetId, input: parsed.input },
  );
  if (!result.ok) {
    switch (result.code) {
      case 'UNAUTHENTICATED':
        redirect('/login');
      case 'INVALID_INPUT':
        return failure(result.code, '', result.fieldErrors);
      case 'DISPLAY_ID_TAKEN':
        return failure(result.code, '', { displayId: ['このユーザーIDは既に使われています'] });
      default:
        return failure(result.code, MESSAGES[result.code]);
    }
  }

  // 訪問済みのメイン・公開プロフィール・編集フォームの表示を無効化してから移動する。
  revalidatePath('/');
  revalidatePath('/profile/[displayId]', 'page');
  revalidatePath('/profile/[displayId]/edit', 'page');
  revalidatePath('/favorites');
  (await cookies()).set(PROFILE_UPDATED_COOKIE, PROFILE_UPDATED_FLASH, {
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // 表示専用。Client Componentが読み取った直後に削除する。
    httpOnly: false,
  });
  // 遷移先は保存済みのIDから作る（クライアント提供のURLは使わない）。try/catchの外で呼ぶ。
  redirect(profileHref({ displayId: result.profile.displayId, tab: 'tweets' }));
}
