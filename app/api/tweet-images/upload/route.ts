import { getTweetDependencies } from '@/main/container/tweet';
import { errorResponse, guardMutation, jsonResponse } from '@/app/lib/route-guard';
import { reserveImageUpload } from '@/application/usecases/media/reserve-image-upload';

/** 画像1枚分の予約と、予約パスだけに書き込める短命のトークンを発行する。画像の本体は受け取らない。 */
export async function POST(request: Request) {
  const guard = await guardMutation(request);
  if (!guard.ok) return guard.response;
  const { draftId, uploadId, contentType, size } = guard.body;
  if (
    typeof draftId !== 'string' ||
    (uploadId !== undefined && typeof uploadId !== 'string') ||
    typeof contentType !== 'string' ||
    typeof size !== 'number'
  ) {
    return errorResponse('INVALID_REQUEST');
  }

  const result = await reserveImageUpload(getTweetDependencies(), {
    actorId: guard.actorId,
    draftId,
    uploadId,
    contentType,
    size,
  });
  if (result.ok) {
    return jsonResponse(200, { uploadId: result.uploadId, pathname: result.pathname, token: result.token });
  }
  if (result.code === 'INVALID_IMAGE') return jsonResponse(400, { code: result.code, message: result.message });
  return errorResponse(result.code);
}
