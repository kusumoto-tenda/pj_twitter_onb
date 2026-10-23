import { MainNavigation } from '@/app/ui/timeline/main-navigation';

/** 左ナビ（375pxでは上部）と一覧の列。ページ本体と読み込み表示で共有する。 */
export function HomeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col bg-white md:flex-row">
      <div className="md:w-56 md:shrink-0">
        <MainNavigation />
      </div>
      <main className="min-w-0 flex-1 border-gray-200 md:border-r">{children}</main>
    </div>
  );
}
