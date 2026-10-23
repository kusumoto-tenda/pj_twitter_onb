'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  initialCreateAccountState,
  type CreateAccountFormState,
} from '@/app/signin/form-state';
import { ACCOUNT_CREATE_FAILED_MESSAGE } from '@/app/ui/notifications/flash';
import { Toast } from '@/app/ui/notifications/toast';
import { FormField } from './form-field';

type CreateAccountAction = (
  state: CreateAccountFormState,
  formData: FormData,
) => Promise<CreateAccountFormState>;

const emptyValues = { name: '', displayId: '', bio: '' };

export function CreateAccountForm({ action }: { action: CreateAccountAction }) {
  const [state, formAction, pending] = useActionState(action, initialCreateAccountState);
  const failed = state.status === 'error' ? state : null;
  const errors = failed?.fieldErrors ?? {};
  const values = failed?.values ?? emptyValues;

  return (
    <>
      <Toast message={ACCOUNT_CREATE_FAILED_MESSAGE} tone="error" trigger={failed?.attempt ?? null} />
      {/* 失敗のたびに再マウントし、名前・ID・自己紹介だけを再表示する（パスワードは空にする）。 */}
      <form key={failed?.attempt ?? 0} action={formAction} noValidate className="space-y-5">
        {failed?.code === 'ACCOUNT_CREATED_SESSION_FAILED' && (
          <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm">
            <p>アカウントは作成済みです。ログインしてください</p>
            <Link href="/login" className="mt-2 inline-block font-bold text-sky-600 underline">
              ログイン画面へ
            </Link>
          </div>
        )}
        <FormField id="displayId" label="ユーザーID" errors={errors.displayId}>
          {(props) => (
            <input
              {...props}
              name="displayId"
              type="text"
              autoComplete="username"
              defaultValue={values.displayId}
            />
          )}
        </FormField>
        <FormField id="name" label="名前" errors={errors.name}>
          {(props) => (
            <input {...props} name="name" type="text" autoComplete="name" defaultValue={values.name} />
          )}
        </FormField>
        <FormField id="bio" label="自己紹介（任意）" errors={errors.bio}>
          {(props) => <textarea {...props} name="bio" rows={3} defaultValue={values.bio} />}
        </FormField>
        <FormField id="password" label="パスワード" errors={errors.password}>
          {(props) => (
            <input {...props} name="password" type="password" autoComplete="new-password" />
          )}
        </FormField>
        <div className="flex items-center gap-6 pt-2">
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="rounded-lg border-2 border-gray-900 px-6 py-3 font-bold hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50"
          >
            アカウントを作成
          </button>
          <span className="text-gray-700">または</span>
          <Link
            href="/login"
            className="rounded-lg border-2 border-gray-900 px-8 py-3 font-bold hover:bg-gray-100"
          >
            ログイン
          </Link>
        </div>
      </form>
    </>
  );
}
