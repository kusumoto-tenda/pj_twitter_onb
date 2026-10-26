import { getTweetDependencies } from '@/app/_composition/tweet';
import { errorResponse, guardMutation, jsonResponse } from '@/app/lib/route-guard';
import { verifyImageUpload } from '@/application/media/verify-image-upload';

/**
 * アップロード済みの実体を検証する。完了webhookに頼らず、ブラウザからの明示的な要求で行う。
 * 取得先はサーバーが保存した予約パスだけで、本文のURL・サイズ・形式は使わない。
 */
export async function POST(request: Request) {
  const guard = await guardMutation(request);
  if (!guard.ok) return guard.response;
  const { uploadId } = guard.body;
  if (typeof uploadId !== 'string') return errorResponse('INVALID_REQUEST');

  const result = await verifyImageUpload(getTweetDependencies(), { actorId: guard.actorId, uploadId });
  if (result.ok) {
    return jsonResponse(200, { uploadId: result.upload.id, width: result.upload.width, height: result.upload.height });
  }
  if (result.code === 'INVALID_IMAGE') return jsonResponse(400, { code: result.code, message: result.message });
  return errorResponse(result.code);
}
