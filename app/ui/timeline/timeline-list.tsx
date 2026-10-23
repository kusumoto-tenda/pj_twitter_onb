import Link from 'next/link';
import type { TimelineItem } from '@/application/timeline/timeline';
import { TweetCard } from './tweet-card';

export function TimelineList({
  items,
  followingOnly,
}: {
  items: TimelineItem[];
  followingOnly: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-gray-500">
        {followingOnly ? '自分とフォロー中のユーザーの投稿はまだありません' : 'まだ投稿がありません'}
      </p>
    );
  }
  return (
    <div>
      {items.map((item) => (
        <TweetCard key={`${item.key.kind}:${item.key.eventId}`} item={item} />
      ))}
    </div>
  );
}

/** URLのカーソルが不正な場合の表示。通常の0件とは区別する。 */
export function InvalidCursorNotice({ latestHref }: { latestHref: string }) {
  return (
    <div className="px-4 py-10 text-center text-gray-700">
      <p>表示する位置を読み込めませんでした</p>
      <Link href={latestHref} className="mt-3 inline-block font-bold text-sky-600 underline">
        最新に戻る
      </Link>
    </div>
  );
}
