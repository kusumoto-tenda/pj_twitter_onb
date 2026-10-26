import { auth } from '@/app/_auth/auth';
import { LogoutButton } from '@/app/ui/auth/logout-button';
import { normalizeUuid } from '@/domain/shared/uuid';

const authUnavailable = (
  <p className="text-sm text-gray-500">ログイン状態を確認できませんでした。再読み込みしてください</p>
);

/**
 * ナビのログアウト導線。現在のセッションのUUIDだけを読み、利用者DBの実在確認をしない
 * （DB障害中や利用者が消えた後でも、このブラウザのセッションを終了できる）。
 * 認証処理そのものが失敗したら、ボタンを出さずに再読み込みを案内する。
 */
export async function SessionLogoutControl() {
  let sessionId: string | null;
  try {
    sessionId = (await auth())?.user?.id || null;
  } catch {
    return authUnavailable;
  }
  if (sessionId === null) return null;
  const actorId = normalizeUuid(sessionId);
  return actorId ? <LogoutButton expectedActorId={actorId} /> : authUnavailable;
}
