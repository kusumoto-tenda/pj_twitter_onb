'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  initialAccountDeleteState,
  type AccountDeleteFormState,
} from '@/app/profile/[displayId]/delete/form-state';
import { FormField } from '@/app/ui/account/form-field';

type AccountDeleteAction = (
  state: AccountDeleteFormState,
  formData: FormData,
) => Promise<AccountDeleteFormState>;

export function AccountDeleteForm({
  action,
  account,
  cancelHref,
}: {
  action: AccountDeleteAction;
  account: { name: string; displayId: string };
  /** 保存済みIDの自分のプロフィール。 */
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialAccountDeleteState);
  const failed = state.status === 'error' ? state : null;

  return (
    // 失敗のたびに再マウントし、パスワードを空に戻す。
    <form key={failed?.attempt ?? 0} action={formAction} noValidate className="space-y-5 px-4 py-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">パスワードを確認</h1>
        <p className="text-gray-700">登録しているパスワードを入力してください</p>
      </div>
      <p className="rounded-lg border-2 border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
        削除するとアカウント・投稿・フォロー関係・リツイートは元に戻せません
      </p>
      <p className="text-sm [overflow-wrap:anywhere]">
        <span className="font-bold">{account.name}</span>{' '}
        <span className="text-gray-500">@{account.displayId}</span>
      </p>
      {failed?.message && (
        <p role="alert" className="text-sm text-red-600">
          {failed.message}
        </p>
      )}
      <FormField id="password" label="パスワード" errors={failed?.fieldErrors.password}>
        {(props) => (
          <input {...props} name="password" type="password" autoComplete="current-password" />
        )}
      </FormField>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link
          href={cancelHref}
          className="rounded-lg border-2 border-gray-900 px-6 py-3 font-bold hover:bg-gray-100"
        >
          戻る
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="rounded-lg bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-50"
        >
          {pending ? '削除中…' : 'アカウント削除'}
        </button>
      </div>
    </form>
  );
}
