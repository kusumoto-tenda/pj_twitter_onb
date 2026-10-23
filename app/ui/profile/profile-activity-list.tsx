import type { ActivityTab } from '@/application/profile/profile';
import type { TimelineItem } from '@/application/timeline/timeline';
import { TweetCard } from '@/app/ui/timeline/tweet-card';

export function ProfileActivityList({ items, tab }: { items: TimelineItem[]; tab: ActivityTab }) {
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
        <TweetCard key={`${item.key.kind}:${item.key.eventId}`} item={item} />
      ))}
    </div>
  );
}
