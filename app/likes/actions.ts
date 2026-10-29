'use server';

import { revalidatePath } from 'next/cache';
import { resolveViewer } from '@/app/_auth/viewer';
import { getLikeDependencies } from '@/main/container/likes';
import { setLike } from '@/application/usecases/likes/set-like';

const MESSAGES = {
  UNAUTHENTICATED: 'ログイン中のみいいねできます',
  SESSION_CHANGED: 'ログイン中の利用者が変わりました。画面を開き直してください',
  INVALID_REQUEST: 'いいねを変更できませんでした。画面を開き直してください',
  NOT_FOUND: 'このツイートは見つかりませんでした',
  UNAVAILABLE: 'いいねを変更できませんでした。時間をおいて再度お試しください',
} as const;

export type SetLikeActionResult = { ok: true; active: boolean; count: number } | { ok: false; message: string };

/** いいねの状態・件数が出るページ（メイン・プロフィールの各タブ・お気に入り）を再取得させる。 */
function revalidateLikePages() {
  revalidatePath('/');
  revalidatePath('/profile/[displayId]', 'page');
  revalidatePath('/favorites');
}

/**
 * FormDataから投稿ID・active（'true' / 'false' だけ）・画面の利用者（任意）を取り出す。
 * 欠落・重複・File・その他の文字列は拒否する。画面の利用者がなければ未ログインで表示した画面。
 * いいねする利用者はセッションで決めるので、送信内容からは受け取らない。
 */
function parseForm(formData: FormData): { tweetId: string; active: boolean; expectedActorId: string | null } | null {
  const single = (key: string) => {
    const values = formData.getAll(key);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
  };
  const tweetId = single('tweetId');
  const active = single('active');
  const expectedActorId = formData.has('expectedActorId') ? single('expectedActorId') : undefined;
  if (tweetId === null || (active !== 'true' && active !== 'false') || expectedActorId === null) return null;
  return { tweetId, active: active === 'true', expectedActorId: expectedActorId ?? null };
}

/**
 * いいねを登録・解除する。呼ばれるたびに利用者を確認する。未ログインでもログイン画面へは移動せず、
 * 案内だけを返す（その場に留まる）。成功しても画面は移動せず、同じ元投稿を表示するページを再取得させる。
 */
export async function setLikeAction(formData: FormData): Promise<SetLikeActionResult> {
  const parsed = parseForm(formData);
  if (!parsed) return { ok: false, message: MESSAGES.INVALID_REQUEST };

  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return { ok: false, message: MESSAGES.UNAVAILABLE };

  const result = await setLike(getLikeDependencies(), {
    actorId: viewer.status === 'signed-in' ? viewer.profile.id : null,
    ...parsed,
  });
  if (result.ok) {
    revalidateLikePages();
    return result;
  }
  // 対象が既にない場合は、消えた投稿を表示し続けないよう再取得させる。
  if (result.code === 'NOT_FOUND') revalidateLikePages();
  return { ok: false, message: MESSAGES[result.code] };
}
