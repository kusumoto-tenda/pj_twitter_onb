import { validateBio, validateDisplayId, validateName } from './account-validation';

/** プロフィール編集の入力。bioは任意。パスワードは扱わない。 */
export type EditProfileInput = { name: string; displayId: string; bio?: string };

/** 検証・整形済みの編集内容。保存するのはこの3項目だけ。 */
export type ValidEditProfileInput = { name: string; displayId: string; bio: string };

export type EditProfileFieldErrors = Partial<Record<keyof ValidEditProfileInput, string[]>>;

export type EditProfileValidation =
  | { ok: true; value: ValidEditProfileInput }
  | { ok: false; fieldErrors: EditProfileFieldErrors };

/**
 * 登録時と同じルールで編集内容を検証し、全項目のエラーをまとめて返す。
 * 名前だけ前後をtrimし、ID・bioは加工しない。
 */
export function validateEditProfileInput(input: EditProfileInput): EditProfileValidation {
  const value: ValidEditProfileInput = {
    name: input.name.trim(),
    displayId: input.displayId,
    bio: input.bio ?? '',
  };

  const fieldErrors: EditProfileFieldErrors = {};
  const checks = [
    ['name', validateName(input.name)],
    ['displayId', validateDisplayId(value.displayId)],
    ['bio', validateBio(value.bio)],
  ] as const;
  for (const [field, errors] of checks) {
    if (errors.length > 0) fieldErrors[field] = [...errors];
  }

  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true, value };
}
