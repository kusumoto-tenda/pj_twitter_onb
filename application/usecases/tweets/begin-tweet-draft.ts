import { DRAFT_TTL_MS } from '@/domain/value_objects/media/media';
import type { TweetWriter } from '@/domain/repository_ifs/tweet-writer';

export type BeginTweetDraftResult =
  | { ok: true; draftId: string; expiresAt: Date }
  | { ok: false; code: 'UNAUTHENTICATED' | 'UNAVAILABLE' };

/** ダイアログを開く直前に、ログイン中の利用者を所有者とする下書きを作る。 */
export async function beginTweetDraft(
  deps: { tweets: Pick<TweetWriter, 'createDraft'>; newId: () => string; now: () => Date },
  { actorId }: { actorId: string | null },
): Promise<BeginTweetDraftResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  const now = deps.now();
  const draft = { id: deps.newId(), ownerId: actorId, expiresAt: new Date(now.getTime() + DRAFT_TTL_MS), now };
  try {
    await deps.tweets.createDraft(draft);
    return { ok: true, draftId: draft.id, expiresAt: draft.expiresAt };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
