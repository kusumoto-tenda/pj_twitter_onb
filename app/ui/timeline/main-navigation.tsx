import Link from 'next/link';
import { XLogo } from '@/app/ui/x-logo';

const linkClassName =
  'rounded-full px-3 py-2 text-lg font-bold hover:bg-gray-100 aria-[current=page]:text-sky-600 md:text-xl';

/**
 * 左ナビゲーション（375pxでは上部のバー）。
 * 遷移先や処理がまだない項目は表示しない。
 */
export function MainNavigation({
  activePage,
  profileHref,
  children,
}: {
  /** 現在開いているページ。他人のプロフィールなど、どれにも当たらなければnull。 */
  activePage: 'home' | 'profile' | null;
  /** 実在を確認したログイン中の利用者のプロフィールURL。未ログインならnull。 */
  profileHref: string | null;
  /** ナビの末尾に置く操作（投稿ボタンなど）。 */
  children?: React.ReactNode;
}) {
  return (
    <nav
      aria-label="メインメニュー"
      className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 md:sticky md:top-0 md:h-screen md:flex-col md:items-start md:gap-4 md:border-b-0 md:border-r md:px-6 md:py-6"
    >
      <XLogo className="mr-2 text-3xl md:mb-2 md:text-5xl" />
      <Link
        href="/"
        aria-current={activePage === 'home' ? 'page' : undefined}
        className={linkClassName}
      >
        ホーム
      </Link>
      {profileHref && (
        <Link
          href={profileHref}
          aria-current={activePage === 'profile' ? 'page' : undefined}
          className={linkClassName}
        >
          プロフィール
        </Link>
      )}
      {children && <div className="ml-auto md:ml-0 md:mt-4 md:w-full">{children}</div>}
    </nav>
  );
}
