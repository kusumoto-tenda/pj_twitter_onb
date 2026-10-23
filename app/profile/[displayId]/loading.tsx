import { PageShell } from '@/app/ui/layout/page-shell';

/** プロフィールの読み込み中に表示する骨格。プロフィール配下だけに効く。 */
export default function Loading() {
  return (
    <PageShell activePage={null} profileHref={null}>
      <div aria-busy="true" aria-label="読み込み中">
        <div className="space-y-2 border-b border-gray-200 px-4 py-4">
          <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-28 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
        </div>
        <div className="h-12 border-b border-gray-200" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 border-b border-gray-200 px-4 py-4">
            <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
