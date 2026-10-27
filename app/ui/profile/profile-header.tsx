import Link from 'next/link';
import type { ProfileSummary, ProfileTab } from '@/application/profile/profile';
import { profileHref } from '@/app/lib/profile-query';
import { LogoutButton } from '@/app/ui/auth/logout-button';
import { FollowButton } from '@/app/ui/profile/follow-button';

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 利用開始日を `YYYY年MM月DD日から利用しています`（Asia/Tokyo）で表す。 */
export function formatJoinedDate(utc: string): string {
  const parts = dateFormatter.formatToParts(new Date(`${utc.slice(0, 23)}Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}年${part('month')}月${part('day')}日から利用しています`;
}

const countLinkClassName = 'hover:underline aria-[current=page]:font-bold aria-[current=page]:text-sky-600';

export function ProfileHeader({
  profile,
  isSelf,
  viewerId,
  tab,
}: {
  profile: ProfileSummary;
  /** セッションのUUIDと対象のUUIDが一致するか。 */
  isSelf: boolean;
  /** ログイン中の利用者のUUID。未ログインならnull。対象のprofile.idとは別物。 */
  viewerId: string | null;
  tab: ProfileTab;
}) {
  return (
    <section aria-label="プロフィール" className="border-b border-gray-200 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold [overflow-wrap:anywhere]">{profile.name}</h1>
          <p className="text-gray-500">@{profile.displayId}</p>
        </div>
        {isSelf ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-bold text-gray-700">
              自分のプロフィール
            </span>
            <Link
              href={`${profileHref({ displayId: profile.displayId, tab: 'tweets' })}/edit`}
              className="rounded-full border border-gray-300 px-4 py-1 text-sm font-bold hover:bg-gray-100"
            >
              プロフィール編集
            </Link>
            {/* ナビと同じActionを使う。送るのは検証済みのprofile.id（本人と一致済み）。 */}
            <LogoutButton expectedActorId={profile.id} />
          </div>
        ) : (
          // 未ログインでも表示し、押したらActionの案内を通知する。対象は表示IDではなくUUIDで固定する。
          <FollowButton targetId={profile.id} active={profile.followedByViewer} expectedActorId={viewerId} />
        )}
      </div>
      {profile.bio && (
        <p data-bio className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {profile.bio}
        </p>
      )}
      <p className="mt-3 text-sm text-gray-500">{formatJoinedDate(profile.createdAt)}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link
          href={profileHref({ displayId: profile.displayId, tab: 'following' })}
          aria-current={tab === 'following' ? 'page' : undefined}
          className={countLinkClassName}
        >
          {profile.followingCount} フォロー
        </Link>
        <Link
          href={profileHref({ displayId: profile.displayId, tab: 'followers' })}
          aria-current={tab === 'followers' ? 'page' : undefined}
          className={countLinkClassName}
        >
          {profile.followerCount} フォロワー
        </Link>
      </div>
    </section>
  );
}
