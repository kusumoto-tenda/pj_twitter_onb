import type { TweetWriter } from '@/domain/repository_ifs/tweet-writer';

export type DiscardTweetDraftResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'PUBLISHED' | 'UNAVAILABLE' };

/** ダイアログのキャンセル。本人の未投稿の下書きを破棄し、画像の実体は後で回収する。 */
export async function discardTweetDraft(
  deps: { tweets: Pick<TweetWriter, 'discardDraft'>; now: () => Date },
  { actorId, draftId }: { actorId: string | null; draftId: string },
): Promise<DiscardTweetDraftResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  try {
    const outcome = await deps.tweets.discardDraft({ actorId, draftId, now: deps.now() });
    switch (outcome) {
      case 'discarded':
        return { ok: true };
      case 'forbidden':
        return { ok: false, code: 'FORBIDDEN' };
      case 'not-found':
        return { ok: false, code: 'NOT_FOUND' };
      case 'published':
        return { ok: false, code: 'PUBLISHED' };
    }
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
