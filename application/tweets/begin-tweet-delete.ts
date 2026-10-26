import { normalizeUuid } from '@/domain/shared/uuid';
import type { TweetDeleter } from './ports/tweet-deleter';
import type { BeginTweetDeleteResult } from './tweet-delete';

/**
 * 削除の確認ダイアログを開く直前に、本人の投稿か確かめる。何も変更しない。
 * 返した actorId は確定時に「準備時の利用者」として照合する。
 */
export async function beginTweetDelete(
  deps: { deleter: Pick<TweetDeleter, 'findTarget'> },
  { actorId, tweetId }: { actorId: string | null; tweetId: string },
): Promise<BeginTweetDeleteResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  const id = normalizeUuid(tweetId);
  if (id === null) return { ok: false, code: 'INVALID_REQUEST' };
  try {
    const target = await deps.deleter.findTarget(id);
    if (!target) return { ok: false, code: 'NOT_FOUND' };
    if (target.ownerId !== actorId) return { ok: false, code: 'FORBIDDEN' };
    return { ok: true, value: { tweetId: target.tweetId, actorId, content: target.content } };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
