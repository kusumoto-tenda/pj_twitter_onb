'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveViewer } from '@/app/_auth/viewer';
import { getTweetDependencies } from '@/main/container/tweet';
import { FLASH_MAX_AGE_SECONDS, TWEET_FLASH_COOKIE, type TweetFlashValue } from '@/app/ui/notifications/flash';
import { beginTweetDraft } from '@/application/usecases/tweets/begin-tweet-draft';
import { createTweet } from '@/application/usecases/tweets/create-tweet';
import type { TweetFieldErrors } from '@/domain/value_objects/tweets/tweet-validation';
import type { CreateTweetErrorCode, CreateTweetFormState } from './form-state';

const MESSAGES = {
  INVALID_REQUEST: '入力内容を確認して、もう一度お試しください',
  FORBIDDEN: 'この下書きからは投稿できません。閉じて開き直してください',
  DRAFT_EXPIRED: '投稿の準備が切れました。閉じて開き直してください',
  CONFLICT: 'この下書きは別の内容で投稿済みです',
  UNAVAILABLE: 'ツイートできませんでした。時間をおいて再度お試しください',
} as const;

async function setTweetFlash(value: TweetFlashValue) {
  (await cookies()).set(TWEET_FLASH_COOKIE, value, {
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // 表示専用。Client Componentが読み取った直後に削除する。
    httpOnly: false,
  });
}

async function redirectToLogin(): Promise<never> {
  await setTweetFlash('login-required');
  redirect('/login');
}

/**
 * ダイアログを開く直前に、サーバーで利用者の実在を確認して下書きを作る。
 * 未ログインならダイアログを開かずにログイン画面へ移動する。
 */
export async function beginTweetDraftAction(): Promise<
  { ok: true; draftId: string } | { ok: false; message: string }
> {
  const viewer = await resolveViewer();
  const unavailable = { ok: false as const, message: 'ツイートの準備ができませんでした。時間をおいて再度お試しください' };
  if (viewer.status === 'unavailable') return unavailable;
  if (viewer.status === 'anonymous') return redirectToLogin();

  const result = await beginTweetDraft(getTweetDependencies(), { actorId: viewer.profile.id });
  return result.ok ? { ok: true, draftId: result.draftId } : unavailable;
}

/** FormDataから下書きID・本文・順序付きの画像IDだけを取り出す。Fileや重複は拒否する。 */
function parseForm(formData: FormData): { draftId: string; content: string; uploadIds: string[] } | null {
  const single = (key: string) => {
    const values = formData.getAll(key);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
  };
  const draftId = single('draftId');
  const content = formData.has('content') ? single('content') : '';
  const uploadIds = formData.getAll('uploadIds');
  if (draftId === null || content === null || uploadIds.some((v) => typeof v !== 'string')) return null;
  return { draftId, content, uploadIds: uploadIds as string[] };
}

/**
 * 投稿を確定する。呼ばれるたびに利用者を確認し、所有者・日時・画像の状態はサーバーで決める。
 * 画像の本体はここを通らない（直接アップロード済みのIDだけを受け取る）。
 */
export async function createTweetAction(
  previous: CreateTweetFormState,
  formData: FormData,
): Promise<CreateTweetFormState> {
  const attempt = previous.status === 'error' ? previous.attempt + 1 : 1;
  const failure = (
    code: CreateTweetErrorCode,
    message: string,
    fieldErrors: TweetFieldErrors = {},
  ): CreateTweetFormState => ({ status: 'error', code, message, fieldErrors, attempt });

  const parsed = parseForm(formData);
  if (!parsed) return failure('INVALID_REQUEST', MESSAGES.INVALID_REQUEST);

  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return failure('UNAVAILABLE', MESSAGES.UNAVAILABLE);
  if (viewer.status === 'anonymous') return redirectToLogin();

  const result = await createTweet(getTweetDependencies(), {
    actorId: viewer.profile.id,
    draftId: parsed.draftId,
    input: { content: parsed.content, uploadIds: parsed.uploadIds },
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
        return failure(result.code, MESSAGES[result.code]);
    }
  }

  revalidatePath('/');
  revalidatePath('/profile/[displayId]', 'page');
  await setTweetFlash('posted');
  // 成功後はメイン画面の先頭へ移動する（フォロー条件・ページ位置は引き継がない）。try/catchの外で呼ぶ。
  redirect('/');
}
