import { PageShell } from '@/app/ui/layout/page-shell';

/** お気に入り一覧の読み込み中に表示する骨格。 */
export default function Loading() {
  return (
    <PageShell activePage="favorites" profileHref={null}>
      <div aria-busy="true" aria-label="読み込み中">
        <div className="border-b border-gray-200 px-4 py-3">
          <div className="h-7 w-32 animate-pulse rounded bg-gray-200" />
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2 border-b border-gray-200 px-4 py-4">
            <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
