import type { Metadata } from 'next';
import { CreateAccountForm } from '@/app/ui/account/create-account-form';
import { XLogo } from '@/app/ui/x-logo';
import { createAccountAction } from './actions';

export const metadata: Metadata = { title: 'アカウント作成' };

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center gap-16 bg-gray-50 p-8">
      <div className="w-full max-w-md">
        <h1 className="mb-8 text-3xl font-black">アカウントを作成</h1>
        <CreateAccountForm action={createAccountAction} />
      </div>
      <XLogo className="hidden text-[16rem] md:block" />
    </main>
  );
}
