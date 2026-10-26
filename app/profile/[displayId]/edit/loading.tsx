import { PageShell } from '@/app/ui/layout/page-shell';

/** 編集画面の読み込み中の骨格。 */
export default function Loading() {
  return (
    <PageShell activePage={null} profileHref={null}>
      <div aria-busy="true" aria-label="読み込み中" className="space-y-5 px-4 py-5">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
            <div className="h-12 w-full animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
