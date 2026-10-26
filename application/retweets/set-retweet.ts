import { normalizeUuid } from '@/domain/shared/uuid';
import type { SetRetweetResult } from './retweet';
import type { RetweetRepository } from './ports/retweet-repository';

/**
 * 元投稿へのリツイートを明示されたactiveで登録・解除する。自己投稿も許可する。
 * actorIdはサーバーで確認した利用者、expectedActorIdは画面表示時の利用者。切り替わっていれば変更しない。
 */
export async function setRetweet(
  deps: { retweets: RetweetRepository; newId: () => string; now: () => Date },
  input: { actorId: string | null; expectedActorId: string | null; tweetId: string; active: boolean },
): Promise<SetRetweetResult> {
  if (input.actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  if (input.expectedActorId === null) return { ok: false, code: 'SESSION_CHANGED' };
  const actorId = normalizeUuid(input.actorId);
  const expectedActorId = normalizeUuid(input.expectedActorId);
  const tweetId = normalizeUuid(input.tweetId);
  if (actorId === null || expectedActorId === null || tweetId === null) return { ok: false, code: 'INVALID_REQUEST' };
  if (actorId !== expectedActorId) return { ok: false, code: 'SESSION_CHANGED' };

  try {
    const outcome = await deps.retweets.set({ actorId, tweetId, active: input.active, id: deps.newId(), now: deps.now() });
    if (outcome.status === 'set') return { ok: true, active: outcome.active, count: outcome.count };
    return { ok: false, code: outcome.status === 'actor-not-found' ? 'UNAUTHENTICATED' : 'NOT_FOUND' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
