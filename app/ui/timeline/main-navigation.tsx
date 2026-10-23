import Link from 'next/link';
import { XLogo } from '@/app/ui/x-logo';

/**
 * 左ナビゲーション（375pxでは上部のバー）。
 * 遷移先や処理がまだない項目は表示しない。
 */
export function MainNavigation() {
  return (
    <nav
      aria-label="メインメニュー"
      className="flex items-center gap-4 border-b border-gray-200 px-4 py-2 md:sticky md:top-0 md:h-screen md:flex-col md:items-start md:gap-6 md:border-b-0 md:border-r md:px-6 md:py-6"
    >
      <XLogo className="text-3xl md:text-5xl" />
      <Link
        href="/"
        aria-current="page"
        className="rounded-full px-3 py-2 text-lg font-bold hover:bg-gray-100 md:text-xl"
      >
        ホーム
      </Link>
    </nav>
  );
}
