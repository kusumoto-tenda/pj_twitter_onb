import { PageShell } from '@/app/ui/layout/page-shell';

/** メイン画面のレイアウト。ページ本体と読み込み表示で共有する。 */
export function HomeShell({
  profileHref = null,
  children,
}: {
  profileHref?: string | null;
  children: React.ReactNode;
}) {
  return (
    <PageShell activePage="home" profileHref={profileHref}>
      {children}
    </PageShell>
  );
}
