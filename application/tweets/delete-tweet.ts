import { normalizeUuid } from '@/domain/shared/uuid';
import type { TweetDeleter } from './ports/tweet-deleter';
import type { DeleteTweetResult } from './tweet-delete';

/**
 * 削除を確定する。actorIdは保存のたびにサーバーで確認したログイン中の利用者、
 * expectedActorIdは確認ダイアログを開いたときの利用者。食い違えば誰の投稿も削除しない。
 */
export async function deleteTweet(
  deps: { deleter: Pick<TweetDeleter, 'deleteOwned'> },
  { actorId, expectedActorId, tweetId }: { actorId: string | null; expectedActorId: string; tweetId: string },
): Promise<DeleteTweetResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  const expected = normalizeUuid(expectedActorId);
  const id = normalizeUuid(tweetId);
  if (expected === null || id === null) return { ok: false, code: 'INVALID_REQUEST' };
  if (expected !== actorId) return { ok: false, code: 'SESSION_CHANGED' };
  try {
    const outcome = await deps.deleter.deleteOwned({ actorId, tweetId: id });
    if (outcome === 'deleted') return { ok: true };
    return { ok: false, code: outcome === 'forbidden' ? 'FORBIDDEN' : 'NOT_FOUND' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
