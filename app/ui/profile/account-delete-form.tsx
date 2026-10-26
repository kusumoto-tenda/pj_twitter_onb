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
  const [state, formAction] = useActionState(action, initialAccountDeleteState);
  const failed = state.status === 'error' ? state : null;

  return (
    <form key={failed?.attempt ?? 0} action={formAction} noValidate className="space-y-5 px-4 py-6">
      <h1 className="text-2xl font-bold">パスワードを確認</h1>
      <p className="text-sm">
        <span className="font-bold">{account.name}</span>{' '}
        <span className="text-gray-500">@{account.displayId}</span>
      </p>
      <FormField id="password" label="パスワード" errors={failed?.fieldErrors.password}>
        {(props) => (
          <input {...props} name="password" type="password" autoComplete="current-password" />
        )}
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={cancelHref}>戻る</Link>
        <button type="submit">アカウント削除</button>
      </div>
    </form>
  );
}
