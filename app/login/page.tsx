import type { Metadata } from 'next';
import { LoginForm } from '@/app/ui/account/login-form';
import { XLogo } from '@/app/ui/x-logo';
import { loginAction } from './actions';

export const metadata: Metadata = { title: 'ログイン' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center gap-16 bg-gray-50 p-8">
      <div className="w-full max-w-md">
        <h1 className="mb-8 text-4xl font-black">すべての話題が、ここに。</h1>
        <LoginForm action={loginAction} />
      </div>
      <XLogo className="hidden text-[16rem] md:block" />
    </main>
  );
}
