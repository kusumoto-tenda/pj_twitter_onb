'use server';

import { revalidatePath } from 'next/cache';
import { resolveViewer } from '@/app/_auth/viewer';
import { getFollowDependencies } from '@/app/_composition/follow';
import { setFollow } from '@/application/follows/set-follow';

const MESSAGES = {
  UNAUTHENTICATED: 'ログイン中のみフォローできます',
  SESSION_CHANGED: 'ログイン中の利用者が変わりました。画面を開き直してください',
  INVALID_REQUEST: 'フォローを変更できませんでした。画面を開き直してください',
  SELF_FOLLOW: '自分自身はフォローできません',
  NOT_FOUND: 'このユーザーは見つかりませんでした',
  UNAVAILABLE: 'フォローを変更できませんでした。時間をおいて再度お試しください',
} as const;

export type SetFollowActionResult = { ok: true; active: boolean } | { ok: false; message: string };

/**
 * フォローの状態・人数・関係一覧・フォローのみの絞り込みが出るページを再取得させる。
 * 対象のページだけでなく、本人のプロフィールや別の利用者のページでの状態も変わるため、全プロフィールを対象にする。
 */
function revalidateFollowPages() {
  revalidatePath('/');
  revalidatePath('/profile/[displayId]', 'page');
  revalidatePath('/favorites');
}

/**
 * FormDataから対象者のUUID・active（'true' / 'false' だけ）・画面の利用者（任意）を取り出す。
 * 欠落・重複・File・その他の文字列は拒否する。画面の利用者がなければ未ログインで表示した画面。
 * フォローする利用者はセッションで決めるので、送信内容（実行者・関係のID）からは受け取らない。
 */
function parseForm(formData: FormData): { targetId: string; active: boolean; expectedActorId: string | null } | null {
  const single = (key: string) => {
    const values = formData.getAll(key);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
  };
  const targetId = single('targetId');
  const active = single('active');
  const expectedActorId = formData.has('expectedActorId') ? single('expectedActorId') : undefined;
  if (targetId === null || (active !== 'true' && active !== 'false') || expectedActorId === null) return null;
  return { targetId, active: active === 'true', expectedActorId: expectedActorId ?? null };
}

/**
 * 対象者のフォローを登録・解除する。呼ばれるたびに利用者を確認する。未ログインでもログイン画面へは移動せず、
 * 案内だけを返す（その場に留まる）。成功しても画面は移動せず、関係が表示されるページを再取得させる。
 */
export async function setFollowAction(formData: FormData): Promise<SetFollowActionResult> {
  const parsed = parseForm(formData);
  if (!parsed) return { ok: false, message: MESSAGES.INVALID_REQUEST };

  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') return { ok: false, message: MESSAGES.UNAVAILABLE };

  const result = await setFollow(getFollowDependencies(), {
    actorId: viewer.status === 'signed-in' ? viewer.profile.id : null,
    ...parsed,
  });
  if (result.ok) {
    revalidateFollowPages();
    return result;
  }
  // 対象が既にいない場合は、消えたプロフィールを表示し続けないよう再取得させる。
  if (result.code === 'NOT_FOUND') revalidateFollowPages();
  return { ok: false, message: MESSAGES[result.code] };
}
