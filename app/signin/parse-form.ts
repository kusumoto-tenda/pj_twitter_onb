import { readStringFields } from '@/app/lib/form-data';
import type { CreateAccountInput } from '@/domain/users/user';

/** 登録フォームのFormDataを入力に変換する。UUID・作成日時などクライアント提供の値は採用しない。 */
export function parseCreateAccountForm(
  formData: FormData,
): { ok: true; input: CreateAccountInput } | { ok: false } {
  const fields = readStringFields(formData, ['name', 'displayId', 'password'], ['bio']);
  if (!fields) return { ok: false };
  return {
    ok: true,
    input: {
      name: fields.name,
      displayId: fields.displayId,
      bio: fields.bio ?? '',
      password: fields.password,
    },
  };
}
