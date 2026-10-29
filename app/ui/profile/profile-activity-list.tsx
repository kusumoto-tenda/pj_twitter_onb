import type { ActivityTab } from '@/application/dtos/profile/profile';
import type { TimelineItem } from '@/application/dtos/timeline/timeline';
import { TweetCard } from '@/app/ui/timeline/tweet-card';

export function ProfileActivityList({
  items,
  tab,
  viewerId = null,
}: {
  items: TimelineItem[];
  tab: ActivityTab;
  /** 確認済みのログイン中の利用者。本人の投稿にだけ三点メニューを出すために使う。 */
  viewerId?: string | null;
}) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-gray-500">
        {tab === 'tweets' ? 'まだ投稿がありません' : 'まだリツイートがありません'}
      </p>
    );
  }
  return (
    <div>
      {items.map((item) => (
        <TweetCard key={`${item.key.kind}:${item.key.eventId}`} item={item} viewerId={viewerId} />
      ))}
    </div>
  );
}
