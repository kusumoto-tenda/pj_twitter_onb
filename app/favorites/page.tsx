import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveViewer } from '@/app/_auth/viewer';
import { getFavoriteDependencies } from '@/app/_composition/favorites';
import type { SearchParamValue } from '@/app/lib/cursor-validation';
import { encodeFavoriteCursor, favoritesHref, parseFavoriteCursor } from '@/app/lib/favorite-query';
import { profileHref } from '@/app/lib/profile-query';
import { FavoriteList } from '@/app/ui/favorites/favorite-list';
import { PageShell } from '@/app/ui/layout/page-shell';
import { InvalidCursorNotice } from '@/app/ui/timeline/timeline-list';
import { TimelinePagination } from '@/app/ui/timeline/timeline-pagination';
import { TimelineRetry } from '@/app/ui/timeline/timeline-retry';
import { getFavorites } from '@/application/favorites/get-favorites';

export const metadata: Metadata = { title: 'お気に入り' };

const RETRY_MESSAGE = 'お気に入りを取得できませんでした。時間をおいて再度お試しください';

/**
 * ログイン中の本人のお気に入り一覧。対象はセッションで確認した本人のUUIDだけ（URLの値では変えない）。
 * 未ログインはログイン画面へ移動する。不正なカーソル・取得障害・0件を区別して表示する。
 */
export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamValue>>;
}) {
  const query = await searchParams;
  const viewer = await resolveViewer();
  // redirectは例外で遷移するため、try/catchの外で呼ぶ。
  if (viewer.status === 'anonymous') redirect('/login');
  if (viewer.status === 'unavailable') {
    return (
      <PageShell activePage={null} profileHref={null}>
        <TimelineRetry message={RETRY_MESSAGE} />
      </PageShell>
    );
  }

  const actorId = viewer.profile.id;
  const cursor = parseFavoriteCursor(query.cursor, actorId);
  let list: React.ReactNode;
  if (!cursor.ok) {
    list = <InvalidCursorNotice latestHref={favoritesHref(null)} />;
  } else {
    const result = await getFavorites(getFavoriteDependencies(), { actorId, after: cursor.cursor });
    if (!result.ok) {
      list = <TimelineRetry message={RETRY_MESSAGE} />;
    } else {
      const { items, nextCursor } = result.page;
      list = (
        <>
          <FavoriteList items={items} viewerId={actorId} />
          {/* 解除して空になったページ（カーソル指定中）でも、先頭へ戻れるようにする。 */}
          <TimelinePagination
            nextHref={nextCursor ? favoritesHref(encodeFavoriteCursor(actorId, nextCursor)) : null}
            latestHref={cursor.cursor ? favoritesHref(null) : null}
          />
        </>
      );
    }
  }

  return (
    <PageShell activePage="favorites" profileHref={profileHref({ displayId: viewer.profile.displayId, tab: 'tweets' })}>
      <header className="border-b border-gray-200 px-4 py-3">
        <h1 className="text-xl font-bold">お気に入り</h1>
        <p className="text-sm text-gray-500">保存した投稿は自分だけが見られます</p>
      </header>
      {list}
    </PageShell>
  );
}
