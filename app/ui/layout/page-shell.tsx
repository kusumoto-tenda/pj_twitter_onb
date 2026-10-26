import { Suspense } from 'react';
import { SessionLogoutControl } from '@/app/ui/auth/session-logout-control';
import { MainNavigation } from '@/app/ui/timeline/main-navigation';
import { CreateTweetLauncher } from '@/app/ui/tweets/create-tweet-launcher';

/** 左ナビ（375pxでは上部）と本文の列。ナビの末尾に投稿とログアウトを置く。メイン画面・プロフィール画面で共有する。 */
export function PageShell({
  activePage,
  profileHref,
  children,
}: {
  activePage: 'home' | 'profile' | 'favorites' | null;
  profileHref: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col bg-white md:flex-row">
      <div className="md:w-56 md:shrink-0">
        <MainNavigation activePage={activePage} profileHref={profileHref}>
          <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch md:gap-3">
            <CreateTweetLauncher />
            {/* 認証の確認を待つ間もナビ・本文を表示する。 */}
            <Suspense fallback={null}>
              <SessionLogoutControl />
            </Suspense>
          </div>
        </MainNavigation>
      </div>
      <main className="min-w-0 flex-1 border-gray-200 md:border-r">{children}</main>
    </div>
  );
}
