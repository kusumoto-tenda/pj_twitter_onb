import { getTweetDependencies } from '@/app/_composition/tweet';
import { errorResponse, guardMutation, jsonResponse } from '@/app/lib/route-guard';
import { discardImageUpload } from '@/application/media/discard-image-upload';
import { discardTweetDraft } from '@/application/tweets/discard-tweet-draft';

/** 添付の解除（uploadId）またはダイアログのキャンセル（draftId）。本人の未投稿のものだけを破棄する。 */
export async function POST(request: Request) {
  const guard = await guardMutation(request);
  if (!guard.ok) return guard.response;
  const { uploadId, draftId } = guard.body;
  const deps = getTweetDependencies();

  const result =
    typeof uploadId === 'string'
      ? await discardImageUpload(deps, { actorId: guard.actorId, uploadId })
      : typeof draftId === 'string'
        ? await discardTweetDraft(deps, { actorId: guard.actorId, draftId })
        : null;
  if (!result) return errorResponse('INVALID_REQUEST');
  return result.ok ? jsonResponse(200, { ok: true }) : errorResponse(result.code);
}
