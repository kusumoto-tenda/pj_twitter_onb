import Link from 'next/link';

const linkClassName = 'rounded-full border border-gray-300 px-5 py-2 font-bold hover:bg-gray-100';

/** 次ページは一覧を置き換える。ブラウザの戻る操作で前のページへ戻れる。 */
export function TimelinePagination({
  nextHref,
  latestHref,
}: {
  nextHref: string | null;
  /** カーソル指定中の場合だけ、条件を保った先頭へのURL。 */
  latestHref: string | null;
}) {
  if (!nextHref && !latestHref) return null;
  return (
    <nav aria-label="ページ送り" className="flex flex-wrap justify-center gap-3 px-4 py-6">
      {latestHref && (
        <Link href={latestHref} className={linkClassName}>
          最新に戻る
        </Link>
      )}
      {nextHref && (
        <Link href={nextHref} className={linkClassName}>
          次の20件
        </Link>
      )}
    </nav>
  );
}
