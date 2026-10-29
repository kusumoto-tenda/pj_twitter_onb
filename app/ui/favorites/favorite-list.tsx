import type { FavoriteEntry } from '@/application/dtos/favorites/favorite';
import { TweetCard } from '@/app/ui/timeline/tweet-card';

/** 本人のお気に入り一覧。カードは他の一覧と同じ（画像・編集・削除・お気に入りの操作を保つ）。 */
export function FavoriteList({ items, viewerId }: { items: FavoriteEntry[]; viewerId: string }) {
  if (items.length === 0) {
    return <p className="px-4 py-10 text-center text-gray-500">お気に入りはまだありません</p>;
  }
  return (
    <div>
      {items.map((entry) => (
        <TweetCard key={entry.favoriteId} item={entry.item} viewerId={viewerId} />
      ))}
    </div>
  );
}
