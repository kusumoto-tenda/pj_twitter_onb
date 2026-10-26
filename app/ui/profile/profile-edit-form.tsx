'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  initialProfileEditState,
  type ProfileEditFormState,
  type ProfileEditFormValues,
} from '@/app/profile/[displayId]/edit/form-state';
import { FormField } from '@/app/ui/account/form-field';

type ProfileEditAction = (
  state: ProfileEditFormState,
  formData: FormData,
) => Promise<ProfileEditFormState>;

export function ProfileEditForm({
  action,
  initialValues,
  cancelHref,
}: {
  action: ProfileEditAction;
  initialValues: ProfileEditFormValues;
  /** 編集前の保存済みIDのプロフィール。 */
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialProfileEditState);
  const failed = state.status === 'error' ? state : null;
  const errors = failed?.fieldErrors ?? {};
  const values = failed?.values ?? initialValues;

  return (
    // 失敗のたびに再マウントし、送信した入力値を再表示する。
    <form key={failed?.attempt ?? 0} action={formAction} noValidate>
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
        <Link
          href={cancelHref}
          aria-label="編集をキャンセル"
          className="flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none hover:bg-gray-100"
        >
          ×
        </Link>
        <h1 className="flex-1 text-xl font-bold">プロフィールを編集</h1>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="rounded-full bg-gray-900 px-5 py-2 font-bold text-white disabled:cursor-wait disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
      <div className="space-y-5 px-4 py-5">
        {failed?.message && (
          <p role="alert" className="text-sm text-red-600">
            {failed.message}
          </p>
        )}
        <FormField id="name" label="名前" errors={errors.name}>
          {(props) => <input {...props} name="name" type="text" autoComplete="name" defaultValue={values.name} />}
        </FormField>
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
        <FormField id="bio" label="自己紹介" errors={errors.bio}>
          {(props) => <textarea {...props} name="bio" rows={4} defaultValue={values.bio} />}
        </FormField>
      </div>
    </form>
  );
}
