import type { ProfileLikeEntry } from '@/application/profile/profile';
import { TweetCard } from '@/app/ui/timeline/tweet-card';

/**
 * 対象者の公開いいね一覧。カードは他の一覧と同じ（画像・編集・削除・いいね・お気に入りの操作を保つ）。
 * キーはいいねのUUID（元投稿の出来事のキーとは混ぜない）。
 */
export function ProfileLikesList({ items, viewerId }: { items: ProfileLikeEntry[]; viewerId: string | null }) {
  if (items.length === 0) {
    return <p className="px-4 py-10 text-center text-gray-500">いいねした投稿はまだありません</p>;
  }
  return (
    <div>
      {items.map((entry) => (
        <TweetCard key={entry.likeId} item={entry.item} viewerId={viewerId} />
      ))}
    </div>
  );
}
