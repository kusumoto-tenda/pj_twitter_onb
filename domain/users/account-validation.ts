import type { CreateAccountInput, FieldErrors, ValidAccountInput } from './user';

export const NAME_MAX_LENGTH = 50;
export const DISPLAY_ID_MIN_LENGTH = 5;
export const DISPLAY_ID_MAX_LENGTH = 15;
export const BIO_MAX_LENGTH = 160;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 50;

const DISPLAY_ID_PATTERN = /^[A-Za-z0-9_]+$/;

export type AccountValidationResult =
  | { ok: true; value: ValidAccountInput }
  | { ok: false; fieldErrors: FieldErrors };

/** Unicodeコードポイント数で文字数を数える。 */
export function countCharacters(value: string): number {
  return Array.from(value).length;
}

/** 検索・一意性判定に使うユーザーID。表示用の綴りは別に保持する。 */
export function normalizeDisplayId(displayId: string): string {
  return displayId.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function validateName(name: string): string[] {
  const length = countCharacters(name.trim());
  if (length === 0) return ['名前を入力してください'];
  if (length > NAME_MAX_LENGTH) return [`名前は${NAME_MAX_LENGTH}文字以下で入力してください`];
  return [];
}

export function validateDisplayId(displayId: string): string[] {
  const errors: string[] = [];
  const length = countCharacters(displayId);
  if (length < DISPLAY_ID_MIN_LENGTH || length > DISPLAY_ID_MAX_LENGTH) {
    errors.push(
      `ユーザーIDは${DISPLAY_ID_MIN_LENGTH}文字以上${DISPLAY_ID_MAX_LENGTH}文字以下で入力してください`,
    );
  }
  if (length > 0 && !DISPLAY_ID_PATTERN.test(displayId)) {
    errors.push('ユーザーIDには半角英数字とアンダーバー（_）のみ使用できます');
  }
  return errors;
}

export function validateBio(bio: string): string[] {
  if (countCharacters(bio) > BIO_MAX_LENGTH) {
    return [`自己紹介は${BIO_MAX_LENGTH}文字以下で入力してください`];
  }
  return [];
}

export function validatePassword(password: string): string[] {
  const length = countCharacters(password);
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return [
      `パスワードは${PASSWORD_MIN_LENGTH}文字以上${PASSWORD_MAX_LENGTH}文字以下で入力してください`,
    ];
  }
  return [];
}

/** 登録入力の業務ルールを検証し、全項目のエラーをまとめて返す。 */
export function validateAccountInput(input: CreateAccountInput): AccountValidationResult {
  const value: ValidAccountInput = {
    name: input.name.trim(),
    displayId: input.displayId,
    bio: input.bio ?? '',
    password: input.password,
  };

  const fieldErrors: FieldErrors = {};
  const checks = [
    ['name', validateName(input.name)],
    ['displayId', validateDisplayId(value.displayId)],
    ['bio', validateBio(value.bio)],
    ['password', validatePassword(value.password)],
  ] as const;
  for (const [field, errors] of checks) {
    if (errors.length > 0) fieldErrors[field] = [...errors];
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value };
}
