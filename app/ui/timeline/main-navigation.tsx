import { TrashIcon } from '@heroicons/react/24/outline';
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
  activePage: 'home' | 'profile' | 'favorites' | 'accountDelete' | null;
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
      {/* お気に入りは本人専用の一覧なので、ログイン中だけ出す。 */}
      {profileHref && (
        <Link
          href="/favorites"
          aria-current={activePage === 'favorites' ? 'page' : undefined}
          className={linkClassName}
        >
          お気に入り
        </Link>
      )}
      {children && <div className="ml-auto md:ml-0 md:mt-4 md:w-full">{children}</div>}
      {/* 取り消せない操作なので、普段の項目から離してナビの一番下に置く。 */}
      {profileHref && (
        <Link
          href={`${profileHref}/delete`}
          aria-current={activePage === 'accountDelete' ? 'page' : undefined}
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 aria-[current=page]:bg-red-50 md:mt-auto"
        >
          <TrashIcon aria-hidden="true" className="h-5 w-5" />
          アカウント削除
        </Link>
      )}
    </nav>
  );
}
