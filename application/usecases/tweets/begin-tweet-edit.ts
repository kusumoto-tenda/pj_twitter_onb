import { DRAFT_TTL_MS } from '@/domain/value_objects/media/media';
import type { TweetEditor } from '@/domain/repository_ifs/tweet-editor';
import type { BeginTweetEditResult } from '@/application/dtos/tweets/tweet-edit';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 編集ダイアログを開く直前に、本人の投稿か確かめて編集用の下書きを作る。下書きIDと期限はサーバーで決める。 */
export async function beginTweetEdit(
  deps: { editor: Pick<TweetEditor, 'prepare'>; newId: () => string; now: () => Date },
  { actorId, tweetId }: { actorId: string | null; tweetId: string },
): Promise<BeginTweetEditResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  if (!UUID_PATTERN.test(tweetId)) return { ok: false, code: 'NOT_FOUND' };
  const now = deps.now();
  try {
    const outcome = await deps.editor.prepare({
      actorId,
      tweetId: tweetId.toLowerCase(),
      draftId: deps.newId(),
      now,
      expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
    });
    if (outcome.status === 'ready') return { ok: true, value: outcome.value };
    return { ok: false, code: outcome.status === 'forbidden' ? 'FORBIDDEN' : 'NOT_FOUND' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
