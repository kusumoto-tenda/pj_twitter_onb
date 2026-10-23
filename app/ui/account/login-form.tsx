'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { initialLoginState, type LoginFormState } from '@/app/login/form-state';
import { FormField } from './form-field';

type LoginAction = (state: LoginFormState, formData: FormData) => Promise<LoginFormState>;

export function LoginForm({ action }: { action: LoginAction }) {
  const [state, formAction, pending] = useActionState(action, initialLoginState);
  const failed = state.status === 'error' ? state : null;

  return (
    <form key={failed?.attempt ?? 0} action={formAction} noValidate className="space-y-5">
      <FormField id="displayId" label="ユーザーID">
        {(props) => (
          <input
            {...props}
            name="displayId"
            type="text"
            autoComplete="username"
            defaultValue={failed?.displayId ?? ''}
          />
        )}
      </FormField>
      <FormField id="password" label="パスワード">
        {(props) => (
          <input {...props} name="password" type="password" autoComplete="current-password" />
        )}
      </FormField>
      {failed && (
        <p role="alert" className="text-sm text-red-600">
          {failed.message}
        </p>
      )}
      <div className="flex items-center gap-6 pt-2">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="rounded-lg border-2 border-gray-900 px-10 py-3 font-bold hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50"
        >
          ログイン
        </button>
        <span className="text-gray-700">または</span>
        <Link
          href="/signin"
          className="rounded-lg border-2 border-gray-900 px-6 py-3 font-bold hover:bg-gray-100"
        >
          サインイン
        </Link>
      </div>
    </form>
  );
}
