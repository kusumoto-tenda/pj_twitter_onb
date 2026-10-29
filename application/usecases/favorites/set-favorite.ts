import { normalizeUuid } from '@/shared/uuid';
import type { SetFavoriteResult } from '@/application/dtos/favorites/favorite';
import type { FavoriteRepository } from '@/domain/repository_ifs/favorite-repository';

/**
 * お気に入りを登録（active: true）・解除（false）する。actorIdは操作のたびにサーバーで確認した利用者、
 * expectedActorIdは画面を表示したときの利用者（未ログインの画面ならnull）。食い違えば何も変えない。
 */
export async function setFavorite(
  deps: { favorites: FavoriteRepository; newId: () => string; now: () => Date },
  {
    actorId,
    expectedActorId,
    tweetId,
    active,
  }: { actorId: string | null; expectedActorId: string | null; tweetId: string; active: boolean },
): Promise<SetFavoriteResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  if (expectedActorId === null) return { ok: false, code: 'SESSION_CHANGED' };
  const expected = normalizeUuid(expectedActorId);
  const id = normalizeUuid(tweetId);
  if (expected === null || id === null) return { ok: false, code: 'INVALID_REQUEST' };
  if (expected !== actorId) return { ok: false, code: 'SESSION_CHANGED' };
  try {
    const outcome = await deps.favorites.set({ actorId, tweetId: id, active, id: deps.newId(), now: deps.now() });
    if (outcome.status === 'set') return { ok: true, active: outcome.active };
    return { ok: false, code: outcome.status === 'actor-not-found' ? 'UNAUTHENTICATED' : 'NOT_FOUND' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
