import { validateEditTweetInput, type EditTweetInput } from '@/domain/tweets/edit-tweet-validation';
import type { TweetEditor } from './ports/tweet-editor';
import type { UpdateTweetResult } from './tweet-edit';

/**
 * 編集を確定する。actorIdはサーバーで確認したログイン中の利用者。
 * 対象の投稿・版・画像の所属は保存側で下書きから解決し、クライアントの値では差し替えない。
 */
export async function updateTweet(
  deps: { editor: Pick<TweetEditor, 'commit'>; now: () => Date },
  { actorId, draftId, input }: { actorId: string | null; draftId: string; input: EditTweetInput },
): Promise<UpdateTweetResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };

  const validation = validateEditTweetInput(input);
  if (!validation.ok) return { ok: false, code: 'INVALID_INPUT', fieldErrors: validation.fieldErrors };
  const { value } = validation;
  // 再送の判定に使う。保持する既存画像と新規画像を分け、順序も含める。
  const fingerprint = JSON.stringify([value.content, value.keepImageIds, value.uploadIds]);

  try {
    const outcome = await deps.editor.commit({ actorId, draftId, value, fingerprint, now: deps.now() });
    switch (outcome.status) {
      case 'updated':
        return { ok: true, tweetId: outcome.tweetId };
      case 'not-found':
        return { ok: false, code: 'NOT_FOUND' };
      case 'forbidden':
        return { ok: false, code: 'FORBIDDEN' };
      case 'draft-closed':
        return { ok: false, code: 'DRAFT_EXPIRED' };
      case 'conflict':
        return { ok: false, code: 'CONFLICT' };
      case 'upload-not-ready':
        return { ok: false, code: 'UPLOAD_NOT_READY' };
      case 'invalid-images':
        return { ok: false, code: 'INVALID_INPUT', fieldErrors: { images: ['添付画像を確認してください'] } };
    }
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
