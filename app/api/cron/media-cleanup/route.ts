import { timingSafeEqual } from 'node:crypto';
import { getTweetDependencies } from '@/app/_composition/tweet';
import { cleanupMedia } from '@/application/media/cleanup-media';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

/** Vercel Cronから1日1回呼ばれる画像の回収。CRON_SECRETによる認証を必須にする。 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const result = await cleanupMedia(getTweetDependencies(), {});
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
