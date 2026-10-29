import { getTweetDependencies } from '@/main/container/tweet';

const notFound = () =>
  new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * 投稿済み画像の配信。公開投稿なので閲覧者のログインは不要だが、毎回DBで画像と元投稿の存在を確認し、
 * 未投稿・破棄済み・削除済みは404にする。保存先のURLは受け取らず、DBの行から解決する。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  const { media, storage } = getTweetDependencies();

  const image = await media.findPublishedImage(imageId);
  if (!image) return notFound();
  const stream = await storage.open(image.storageKey);
  if (!stream) return notFound();

  // バッファに溜めずにストリームで返し、検証済みの形式とサイズを使う。
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
