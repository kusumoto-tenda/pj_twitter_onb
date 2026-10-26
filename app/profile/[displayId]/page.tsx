import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveViewer, viewerProfileDisplayId } from '@/app/_auth/viewer';
import { getProfileDependencies } from '@/app/_composition/profile';
import type { SearchParamValue } from '@/app/lib/cursor-validation';
import {
  encodeActivityCursor,
  encodeConnectionCursor,
  parseActivityCursor,
  parseConnectionCursor,
  parseProfileTab,
  profileHref,
} from '@/app/lib/profile-query';
import { PageShell } from '@/app/ui/layout/page-shell';
import { ProfileUpdatedFlash } from '@/app/ui/notifications/profile-updated-flash';
import { ProfileActivityList } from '@/app/ui/profile/profile-activity-list';
import { ProfileConnectionsList } from '@/app/ui/profile/profile-connections-list';
import { ProfileHeader } from '@/app/ui/profile/profile-header';
import { ProfileRetry } from '@/app/ui/profile/profile-retry';
import { ProfileTabs } from '@/app/ui/profile/profile-tabs';
import { InvalidCursorNotice } from '@/app/ui/timeline/timeline-list';
import { TimelinePagination } from '@/app/ui/timeline/timeline-pagination';
import { getProfile } from '@/application/profile/get-profile';
import { getProfileActivity } from '@/application/profile/get-profile-activity';
import { getProfileConnections } from '@/application/profile/get-profile-connections';
import type { ProfileSummary, ProfileTab } from '@/application/profile/profile';

// タイトルのためにDBを重ねて照会しないよう、静的なタイトルにする。
export const metadata: Metadata = { title: 'プロフィール' };

type SearchParams = Record<string, SearchParamValue>;

/**
 * 選択中のタブの一覧を取得して組み立てる。
 * 対象は解決済みのプロフィールのUUIDだけを使い、不正なカーソルではQueryを呼ばない。
 */
async function loadListSection(
  profile: ProfileSummary,
  tab: ProfileTab,
  cursorParam: SearchParamValue,
): Promise<React.ReactNode> {
  const deps = getProfileDependencies();
  const latestHref = profileHref({ displayId: profile.displayId, tab });
  const pagination = (nextCursor: string | null, hasCursor: boolean) => (
    <TimelinePagination
      nextHref={nextCursor ? profileHref({ displayId: profile.displayId, tab, cursor: nextCursor }) : null}
      latestHref={hasCursor ? latestHref : null}
    />
  );

  if (tab === 'tweets' || tab === 'retweets') {
    const cursor = parseActivityCursor(cursorParam, profile.id, tab);
    if (!cursor.ok) return <InvalidCursorNotice latestHref={latestHref} />;
    const result = await getProfileActivity(deps, {
      subjectId: profile.id,
      kind: tab === 'tweets' ? 'tweet' : 'retweet',
      after: cursor.cursor,
    });
    if (!result.ok) return <ProfileRetry scope="list" />;
    const { items, nextCursor } = result.page;
    return (
      <>
        <ProfileActivityList items={items} tab={tab} />
        {pagination(
          nextCursor ? encodeActivityCursor(profile.id, tab, nextCursor) : null,
          cursor.cursor !== null,
        )}
      </>
    );
  }

  const cursor = parseConnectionCursor(cursorParam, profile.id, tab);
  if (!cursor.ok) return <InvalidCursorNotice latestHref={latestHref} />;
  const result = await getProfileConnections(deps, {
    subjectId: profile.id,
    direction: tab,
    after: cursor.cursor,
  });
  if (!result.ok) return <ProfileRetry scope="list" />;
  const { items, nextCursor } = result.page;
  return (
    <>
      <ProfileConnectionsList people={items} direction={tab} />
      {pagination(
        nextCursor ? encodeConnectionCursor(profile.id, tab, nextCursor) : null,
        cursor.cursor !== null,
      )}
    </>
  );
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ displayId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { displayId } = await params;
  const query = await searchParams;
  const tab = parseProfileTab(query.tab);

  // 利用者の確認に失敗した場合は未ログインと同じく扱い、自分判定や自分のリンクを出さない。
  const viewer = await resolveViewer();
  const viewerId = viewer.status === 'signed-in' ? viewer.profile.id : null;
  const ownDisplayId = viewerProfileDisplayId(viewer);
  const ownProfileHref = ownDisplayId ? profileHref({ displayId: ownDisplayId, tab: 'tweets' }) : null;

  const result = await getProfile(getProfileDependencies(), { displayId, viewerId });
  // notFoundは例外で404を表示するため、try/catchの外で呼ぶ。障害は404にしない。
  if (!result.ok && result.code === 'NOT_FOUND') notFound();
  if (!result.ok) {
    return (
      <PageShell activePage={null} profileHref={ownProfileHref}>
        <ProfileRetry scope="profile" />
      </PageShell>
    );
  }

  const { profile } = result;
  // 自分かどうかはDBの対象UUIDとセッションのUUIDで判断する（URLの綴りでは判断しない）。
  const isSelf = viewerId !== null && viewerId === profile.id;
  const list = await loadListSection(profile, tab, query.cursor);

  return (
    <PageShell activePage={isSelf ? 'profile' : null} profileHref={ownProfileHref}>
      <ProfileUpdatedFlash />
      <ProfileHeader profile={profile} isSelf={isSelf} tab={tab} />
      <ProfileTabs displayId={profile.displayId} tab={tab} />
      {list}
    </PageShell>
  );
}
