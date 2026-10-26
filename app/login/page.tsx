import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/app/_auth/auth';
import { getAccountDependencies } from '@/app/_composition/account';
import { LoginForm } from '@/app/ui/account/login-form';
import { AccountDeletedFlash } from '@/app/ui/notifications/account-deleted-flash';
import { XLogo } from '@/app/ui/x-logo';
import { findAccountProfile } from '@/application/users/find-account-profile';
import { loginAction } from './actions';

export const metadata: Metadata = { title: 'ログイン' };

/** セッションのUUIDに対応する利用者がDBに存在するか。Cookieの有無だけでは判断しない。 */
async function hasActiveAccount(): Promise<boolean> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return false;
  try {
    return (await findAccountProfile(getAccountDependencies(), id)) !== null;
  } catch {
    // 確認できない場合もログインフォームは使えるようにする。送信時の障害はActionで扱う。
    return false;
  }
}

export default async function LoginPage() {
  // redirectは例外で遷移するため、try/catchの外で呼ぶ。
  if (await hasActiveAccount()) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center gap-16 bg-gray-50 px-4 py-8 sm:p-8">
      <AccountDeletedFlash />
      <div className="w-full max-w-md">
        <h1 className="mb-8 text-3xl font-black sm:text-4xl">すべての話題が、ここに。</h1>
        <LoginForm action={loginAction} />
      </div>
      <XLogo className="hidden text-[16rem] md:block" />
    </main>
  );
}
