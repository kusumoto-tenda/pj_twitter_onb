import Link from 'next/link';
import { auth } from '@/app/_auth/auth';
import { getAccountDependencies } from '@/app/_composition/account';
import { AccountCreatedFlash } from '@/app/ui/notifications/account-created-flash';
import { XLogo } from '@/app/ui/x-logo';
import { findAccountProfile } from '@/application/users/find-account-profile';

/** 登録後の認証状態と通知を確認するための最小のメイン画面。 */
export default async function HomePage() {
  const session = await auth();
  const profile = session?.user?.id
    ? await findAccountProfile(getAccountDependencies(), session.user.id)
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl border-x border-gray-200 bg-white">
      <AccountCreatedFlash />
      <header className="flex items-center gap-3 border-b border-gray-200 p-4">
        <XLogo className="text-3xl" />
        <h1 className="text-xl font-bold">ホーム</h1>
      </header>
      {profile ? (
        <section aria-label="ログイン中のユーザー" className="p-4">
          <p className="text-lg font-bold">{profile.name}</p>
          <p className="text-gray-500">@{profile.displayId}</p>
        </section>
      ) : (
        <section className="flex gap-4 p-4">
          <Link href="/login" className="rounded-full bg-sky-500 px-6 py-2 font-bold text-white">
            ログイン
          </Link>
          <Link href="/signin" className="rounded-full border border-gray-300 px-6 py-2 font-bold">
            アカウントを作成
          </Link>
        </section>
      )}
    </main>
  );
}
