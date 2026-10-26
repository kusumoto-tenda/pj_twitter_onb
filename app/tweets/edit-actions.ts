'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveViewer } from '@/app/_auth/viewer';
import { getTweetDependencies } from '@/app/_composition/tweet';
import { FLASH_MAX_AGE_SECONDS, TWEET_FLASH_COOKIE } from '@/app/ui/notifications/flash';
import type { EditableTweet } from '@/application/tweets/ports/tweet-editor';
import { beginTweetEdit } from '@/application/tweets/begin-tweet-edit';
import { updateTweet } from '@/application/tweets/update-tweet';
import type { TweetFieldErrors } from '@/domain/tweets/tweet-validation';
import type { EditTweetErrorCode, EditTweetFormState } from './edit-form-state';

const BEGIN_MESSAGES = {
  NOT_FOUND: 'このツイートは見つかりませんでした',
  FORBIDDEN: 'このツイートは編集できません',
  UNAVAILABLE: 'ツイートを編集できませんでした。時間をおいて再度お試しください',
} as const;

const UPDATE_MESSAGES = {
  INVALID_REQUEST: '入力内容を確認して、もう一度お試しください',
  NOT_FOUND: 'このツイートは見つかりませんでした。閉じてください',
  FORBIDDEN: 'このツイートは編集できません。閉じて開き直してください',
  DRAFT_EXPIRED: '編集の準備が切れました。閉じて開き直してください',
  CONFLICT: '他の画面で更新されています。閉じて開き直してください',
  UNAVAILABLE: 'ツイートを更新できませんでした。時間をおいて再度お試しください',
} as const;

/** 未ログインなら、ログイン画面で編集用の案内を出す。 */
async function redirectToLogin(): Promise<never> {
  (await cookies()).set(TWEET_FLASH_COOKIE, 'edit-login-required', {
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  });
  redirect('/login');
}

/**
 * 編集ダイアログを開く直前に、サーバーで利用者と投稿の所有者を確認し、DBの現在の内容で下書きを作る。
 * カードから受け取るのは投稿IDだけで、カードの古い内容は初期値に使わない。
 */
export async function beginTweetEditAction(
  tweetId: string,
): Promise<{ ok: true; value: EditableTweet } | { ok: false; message: string }> {
  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return { ok: false, message: BEGIN_MESSAGES.UNAVAILABLE };
  if (viewer.status === 'anonymous') return redirectToLogin();

  const result = await beginTweetEdit(getTweetDependencies(), { actorId: viewer.profile.id, tweetId });
  if (result.ok) return { ok: true, value: result.value };
  if (result.code === 'UNAUTHENTICATED') return redirectToLogin();
  return { ok: false, message: BEGIN_MESSAGES[result.code] };
}

/** FormDataから下書きID・本文・保持する画像ID・新規の画像IDだけを取り出す。Fileや重複は拒否する。 */
function parseForm(
  formData: FormData,
): { draftId: string; content: string; keepImageIds: string[]; uploadIds: string[] } | null {
  const single = (key: string) => {
    const values = formData.getAll(key);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
  };
  const many = (key: string) => {
    const values = formData.getAll(key);
    return values.every((v) => typeof v === 'string') ? (values as string[]) : null;
  };
  const draftId = single('draftId');
  const content = formData.has('content') ? single('content') : '';
  const keepImageIds = many('keepImageIds');
  const uploadIds = many('uploadIds');
  if (draftId === null || content === null || keepImageIds === null || uploadIds === null) return null;
  return { draftId, content, keepImageIds, uploadIds };
}

/**
 * 編集を確定する。呼ばれるたびに利用者を確認し、対象・版・画像の所属はサーバーで下書きから解決する。
 * 成功しても画面は移動しない（現在のURL・一覧の位置を保ち、表示だけを更新する）。
 */
export async function updateTweetAction(
  previous: EditTweetFormState,
  formData: FormData,
): Promise<EditTweetFormState> {
  const attempt = previous.status === 'idle' ? 1 : previous.attempt + 1;
  const failure = (
    code: EditTweetErrorCode,
    message: string,
    fieldErrors: TweetFieldErrors = {},
  ): EditTweetFormState => ({ status: 'error', code, message, fieldErrors, attempt });

  const parsed = parseForm(formData);
  if (!parsed) return failure('INVALID_REQUEST', UPDATE_MESSAGES.INVALID_REQUEST);

  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return failure('UNAVAILABLE', UPDATE_MESSAGES.UNAVAILABLE);
  if (viewer.status === 'anonymous') return redirectToLogin();

  const result = await updateTweet(getTweetDependencies(), {
    actorId: viewer.profile.id,
    draftId: parsed.draftId,
    input: { content: parsed.content, keepImageIds: parsed.keepImageIds, uploadIds: parsed.uploadIds },
  });
  if (!result.ok) {
    switch (result.code) {
      case 'UNAUTHENTICATED':
        return redirectToLogin();
      case 'INVALID_INPUT':
        return failure(result.code, '', result.fieldErrors);
      case 'UPLOAD_NOT_READY':
        return failure(result.code, '', { images: ['画像の準備ができていません。解除して選び直してください'] });
      default:
        return failure(result.code, UPDATE_MESSAGES[result.code]);
    }
  }

  // 確定後だけ、元投稿を参照するメイン・プロフィールの表示を無効化する。
  revalidatePath('/');
  revalidatePath('/profile/[displayId]', 'page');
  revalidatePath('/favorites');
  return { status: 'success', tweetId: result.tweetId, attempt };
}
