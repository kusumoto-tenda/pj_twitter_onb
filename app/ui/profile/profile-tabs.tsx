import Link from 'next/link';
import type { ProfileTab } from '@/application/dtos/profile/profile';
import { profileHref } from '@/app/lib/profile-query';

const TABS = [
  { tab: 'tweets', label: 'ツイート' },
  { tab: 'retweets', label: 'リツイート' },
  { tab: 'likes', label: 'いいね' },
] as const;

/** 投稿・リツイート・公開いいねのタブ。選択状態はURLのタブに従い、切り替えではカーソルを外す。 */
export function ProfileTabs({ displayId, tab }: { displayId: string; tab: ProfileTab }) {
  return (
    <nav aria-label="プロフィールのタブ" className="flex border-b border-gray-200">
      {TABS.map((item) => (
        <Link
          key={item.tab}
          href={profileHref({ displayId, tab: item.tab })}
          aria-current={tab === item.tab ? 'page' : undefined}
          className="flex-1 px-4 py-3 text-center font-bold text-gray-500 hover:bg-gray-50 aria-[current=page]:border-b-4 aria-[current=page]:border-sky-500 aria-[current=page]:text-gray-900"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
