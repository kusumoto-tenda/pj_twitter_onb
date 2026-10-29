import Link from 'next/link';
import type { ConnectionDirection, PublicPerson } from '@/application/dtos/profile/profile';
import { profileHref } from '@/app/lib/profile-query';

const LABELS = {
  following: { list: 'フォロー中のユーザー', empty: 'まだ誰もフォローしていません' },
  followers: { list: 'フォロワー', empty: 'まだフォロワーはいません' },
} as const;

/** フォロー・フォロワーの一覧。各行は名前・IDとプロフィールへのリンクだけを表示する。 */
export function ProfileConnectionsList({
  people,
  direction,
}: {
  people: PublicPerson[];
  direction: ConnectionDirection;
}) {
  const labels = LABELS[direction];
  if (people.length === 0) {
    return <p className="px-4 py-10 text-center text-gray-500">{labels.empty}</p>;
  }
  return (
    <ul aria-label={labels.list}>
      {people.map((person) => (
        <li key={person.id} className="border-b border-gray-200">
          <Link
            href={profileHref({ displayId: person.displayId, tab: 'tweets' })}
            className="block px-4 py-3 hover:bg-gray-50"
          >
            <span className="block font-bold text-gray-900 [overflow-wrap:anywhere]">
              {person.name}
            </span>
            <span className="block text-sm text-gray-500">@{person.displayId}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
