import { normalizeUuid } from '@/domain/shared/uuid';
import type { SetLikeResult } from './like';
import type { LikeRepository } from './ports/like-repository';

/**
 * いいねを登録（active: true）・解除（false）する。対象は元投稿のUUID（リツイート行・実行者ではない）。
 * actorIdは操作のたびにサーバーで確認した利用者、expectedActorIdは画面を表示したときの利用者
 * （未ログインの画面ならnull）。食い違えば誰のいいねも変えない。
 */
export async function setLike(
  deps: { likes: LikeRepository; newId: () => string; now: () => Date },
  {
    actorId,
    expectedActorId,
    tweetId,
    active,
  }: { actorId: string | null; expectedActorId: string | null; tweetId: string; active: boolean },
): Promise<SetLikeResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  if (expectedActorId === null) return { ok: false, code: 'SESSION_CHANGED' };
  const expected = normalizeUuid(expectedActorId);
  const id = normalizeUuid(tweetId);
  if (expected === null || id === null) return { ok: false, code: 'INVALID_REQUEST' };
  if (expected !== actorId) return { ok: false, code: 'SESSION_CHANGED' };
  try {
    const outcome = await deps.likes.set({ actorId, tweetId: id, active, id: deps.newId(), now: deps.now() });
    if (outcome.status === 'set') return { ok: true, active: outcome.active, count: outcome.count };
    return { ok: false, code: outcome.status === 'actor-not-found' ? 'UNAUTHENTICATED' : 'NOT_FOUND' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
