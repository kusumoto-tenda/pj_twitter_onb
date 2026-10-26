'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveViewer } from '@/app/_auth/viewer';
import { getTweetDependencies } from '@/app/_composition/tweet';
import { FLASH_MAX_AGE_SECONDS, TWEET_FLASH_COOKIE } from '@/app/ui/notifications/flash';
import { beginTweetDelete } from '@/application/tweets/begin-tweet-delete';
import { deleteTweet } from '@/application/tweets/delete-tweet';
import type { DeleteTweetFailureCode, DeleteTweetFormState } from './delete-form-state';

const ALREADY_DELETED_MESSAGE = 'このツイートは既に削除されています';

const BEGIN_MESSAGES = {
  INVALID_REQUEST: 'このツイートは見つかりませんでした',
  FORBIDDEN: 'このツイートは削除できません',
  UNAVAILABLE: 'ツイートを削除できませんでした。時間をおいて再度お試しください',
} as const;

const DELETE_MESSAGES: Record<DeleteTweetFailureCode, string> = {
  INVALID_REQUEST: '削除する内容を確認できませんでした。閉じて開き直してください',
  SESSION_CHANGED: 'ログイン中の利用者が変わりました。画面を開き直してください',
  FORBIDDEN: 'このツイートは削除できません',
  UNAVAILABLE: 'ツイートを削除できませんでした。時間をおいて再度お試しください',
};

/** 未ログインなら、ログイン画面で削除用の案内を出す。 */
async function redirectToLogin(): Promise<never> {
  (await cookies()).set(TWEET_FLASH_COOKIE, 'delete-login-required', {
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  });
  redirect('/login');
}

/** 元投稿を参照するメイン・プロフィールの表示を無効化する（リツイートのカードも消える）。 */
function revalidateTweetPages() {
  revalidatePath('/');
  revalidatePath('/profile/[displayId]', 'page');
}

/**
 * 削除の確認ダイアログを開く直前に、サーバーで利用者と投稿の所有者を確認する。何も削除しない。
 * 返した actorId は確定時に「準備時の利用者」として送り返してもらい、照合する。
 */
export async function beginTweetDeleteAction(
  tweetId: string,
): Promise<{ ok: true; value: { tweetId: string; actorId: string; content: string } } | { ok: false; message: string }> {
  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return { ok: false, message: BEGIN_MESSAGES.UNAVAILABLE };
  if (viewer.status === 'anonymous') return redirectToLogin();

  const result = await beginTweetDelete(getTweetDependencies(), { actorId: viewer.profile.id, tweetId });
  if (result.ok) return result;
  switch (result.code) {
    case 'UNAUTHENTICATED':
      return redirectToLogin();
    case 'NOT_FOUND':
      revalidateTweetPages();
      return { ok: false, message: ALREADY_DELETED_MESSAGE };
    default:
      return { ok: false, message: BEGIN_MESSAGES[result.code] };
  }
}

/** FormDataから投稿IDと準備時の利用者だけを取り出す。欠落・重複・Fileは拒否する。 */
function parseForm(formData: FormData): { tweetId: string; expectedActorId: string } | null {
  const single = (key: string) => {
    const values = formData.getAll(key);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
  };
  const tweetId = single('tweetId');
  const expectedActorId = single('expectedActorId');
  return tweetId === null || expectedActorId === null ? null : { tweetId, expectedActorId };
}

/**
 * 削除を確定する（「はい」の送信時だけ呼ばれる）。呼ばれるたびに利用者を確認し、準備時の利用者と照合する。
 * 成功しても画面は移動しない（現在のURL・条件を保ち、表示だけを更新する）。
 */
export async function deleteTweetAction(
  previous: DeleteTweetFormState,
  formData: FormData,
): Promise<DeleteTweetFormState> {
  const attempt = previous.status === 'idle' ? 1 : previous.attempt + 1;
  const failure = (code: DeleteTweetFailureCode): DeleteTweetFormState => ({
    status: 'error',
    code,
    message: DELETE_MESSAGES[code],
    attempt,
  });

  const parsed = parseForm(formData);
  if (!parsed) return failure('INVALID_REQUEST');

  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return failure('UNAVAILABLE');
  if (viewer.status === 'anonymous') return redirectToLogin();

  const result = await deleteTweet(getTweetDependencies(), { actorId: viewer.profile.id, ...parsed });
  if (result.ok) {
    revalidateTweetPages();
    return { status: 'success', attempt };
  }
  switch (result.code) {
    case 'UNAUTHENTICATED':
      return redirectToLogin();
    case 'NOT_FOUND':
      revalidateTweetPages();
      return { status: 'not-found', message: ALREADY_DELETED_MESSAGE, attempt };
    default:
      return failure(result.code);
  }
}
