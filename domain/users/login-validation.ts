import { validateDisplayId, validatePassword } from './account-validation';

export type LoginFieldErrors = Partial<Record<'displayId' | 'password', string[]>>;

export type LoginValidationResult = { ok: true } | { ok: false; fieldErrors: LoginFieldErrors };

/**
 * ログイン入力を登録時と同じ形式ルールで検証する。
 * 入力値はtrim・大小文字変換・Unicode正規化をしない。
 */
export function validateLoginInput(input: {
  displayId: string;
  password: string;
}): LoginValidationResult {
  const fieldErrors: LoginFieldErrors = {};
  const idErrors = validateDisplayId(input.displayId);
  const passwordErrors = validatePassword(input.password);
  if (idErrors.length > 0) fieldErrors.displayId = idErrors;
  if (passwordErrors.length > 0) fieldErrors.password = passwordErrors;
  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true };
}
