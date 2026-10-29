import { normalizeNewlines, readStringFields } from '@/app/lib/form-data';
import type { EditProfileInput } from '@/domain/value_objects/users/profile-edit-validation';

/** 編集フォームのFormDataから3項目だけを取り出す。UUIDや作成日などクライアント提供の値は採用しない。 */
export function parseProfileEditForm(
  formData: FormData,
): { ok: true; input: Required<EditProfileInput> } | { ok: false } {
  const fields = readStringFields(formData, ['name', 'displayId'], ['bio']);
  if (!fields) return { ok: false };
  return { ok: true, input: { name: fields.name, displayId: fields.displayId, bio: normalizeNewlines(fields.bio ?? '') } };
}
