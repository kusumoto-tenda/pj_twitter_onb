import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveViewer, viewerProfileDisplayId, type Viewer } from '@/app/_auth/viewer';
import { getTimelineDependencies } from '@/main/container/timeline';
import { profileHref } from '@/app/lib/profile-query';
import { parseCursorParam, parseFollowParam, timelineHref } from '@/app/lib/timeline-query';
import { AccountCreatedFlash } from '@/app/ui/notifications/account-created-flash';
import { TweetFlash } from '@/app/ui/notifications/tweet-flash';
import { TimelineFilter } from '@/app/ui/timeline/timeline-filter';
import { InvalidCursorNotice, TimelineList } from '@/app/ui/timeline/timeline-list';
import { TimelinePagination } from '@/app/ui/timeline/timeline-pagination';
import { TimelineRetry } from '@/app/ui/timeline/timeline-retry';
import { getTimeline } from '@/application/usecases/timeline/get-timeline';
import { HomeShell } from './layout-shell';

type SearchParams = Record<string, string | string[] | undefined>;

/** 一覧部分を取得して組み立てる。不正なカーソルや閲覧者の確認失敗ではQueryを呼ばない。 */
async function loadTimelineSection(
  viewer: Viewer,
  followingOnly: boolean,
  cursorParam: ReturnType<typeof parseCursorParam>,
): Promise<React.ReactNode> {
  const latestHref = timelineHref({ followingOnly, cursor: null });
  if (viewer.status === 'unavailable') return <TimelineRetry />;
  if (!cursorParam.ok) return <InvalidCursorNotice latestHref={latestHref} />;

  const result = await getTimeline(getTimelineDependencies(), {
    viewerId: viewer.status === 'signed-in' ? viewer.profile.id : null,
    followingOnly,
    after: cursorParam.cursor,
  });
  if (!result.ok) return <TimelineRetry />;

  const { items, nextCursor } = result.page;
  return (
    <>
      <TimelineList
        items={items}
        followingOnly={followingOnly}
        viewerId={viewer.status === 'signed-in' ? viewer.profile.id : null}
      />
      <TimelinePagination
        nextHref={nextCursor ? timelineHref({ followingOnly, cursor: nextCursor }) : null}
        latestHref={cursorParam.cursor ? latestHref : null}
      />
    </>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const followingOnly = parseFollowParam(params.follow);
  const cursorParam = parseCursorParam(params.cursor);
  const viewer = await resolveViewer();

  // フォロー一覧はログインが必要。redirectは例外で遷移するため、try/catchの外で呼ぶ。
  if (followingOnly && viewer.status === 'anonymous') redirect('/login');

  const timeline = await loadTimelineSection(viewer, followingOnly, cursorParam);

  const ownDisplayId = viewerProfileDisplayId(viewer);
  return (
    <HomeShell profileHref={ownDisplayId ? profileHref({ displayId: ownDisplayId, tab: 'tweets' }) : null}>
      <AccountCreatedFlash />
      <TweetFlash />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <h1 className="text-xl font-bold">最新ツイート</h1>
        <TimelineFilter
          loggedIn={viewer.status === 'signed-in'}
          followingOnly={followingOnly}
          toggleHref={timelineHref({ followingOnly: !followingOnly, cursor: null })}
        />
      </header>
      {viewer.status === 'signed-in' && (
        <section aria-label="ログイン中のユーザー" className="border-b border-gray-200 px-4 py-2 text-sm">
          <span className="font-bold">{viewer.profile.name}</span>{' '}
          <span className="text-gray-500">@{viewer.profile.displayId}</span>
        </section>
      )}
      {viewer.status === 'anonymous' && (
        <section className="flex flex-wrap gap-3 border-b border-gray-200 px-4 py-3">
          <Link href="/login" className="rounded-full bg-sky-500 px-5 py-2 font-bold text-white">
            ログイン
          </Link>
          <Link href="/signin" className="rounded-full border border-gray-300 px-5 py-2 font-bold">
            アカウントを作成
          </Link>
        </section>
      )}
      {timeline}
    </HomeShell>
  );
}
