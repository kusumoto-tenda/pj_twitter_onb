import { validateTweetInput, type TweetInput } from '@/domain/value_objects/tweets/tweet-validation';
import type { TweetWriter } from '@/domain/repository_ifs/tweet-writer';
import type { CreateTweetResult } from '@/application/dtos/tweets/tweet';

/**
 * 下書きを投稿として確定する。actorIdはサーバーで確認したログイン中の利用者。
 * 所有者・日時・画像の状態はクライアントから受け取らず、保存側で再確認する。
 */
export async function createTweet(
  deps: { tweets: Pick<TweetWriter, 'publish'>; now: () => Date },
  { actorId, draftId, input }: { actorId: string | null; draftId: string; input: TweetInput },
): Promise<CreateTweetResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };

  const validation = validateTweetInput(input);
  if (!validation.ok) return { ok: false, code: 'INVALID_INPUT', fieldErrors: validation.fieldErrors };
  const { value } = validation;
  // 再送の判定に使う。正規化した本文と順序付きの画像IDが同じなら同じ内容とみなす。
  const fingerprint = JSON.stringify([value.content, value.uploadIds.map((id) => id.toLowerCase())]);

  try {
    const outcome = await deps.tweets.publish({ actorId, draftId, value, fingerprint, now: deps.now() });
    switch (outcome.status) {
      case 'published':
        return { ok: true, tweetId: outcome.tweetId };
      case 'forbidden':
        return { ok: false, code: 'FORBIDDEN' };
      case 'draft-not-found':
      case 'draft-closed':
        return { ok: false, code: 'DRAFT_EXPIRED' };
      case 'upload-not-ready':
        return { ok: false, code: 'UPLOAD_NOT_READY' };
      case 'conflict':
        return { ok: false, code: 'CONFLICT' };
    }
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
