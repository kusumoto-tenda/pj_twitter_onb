/**
 * FormDataから指定した欄の文字列を1つずつ取り出す。
 * File・重複キー・必須欄の欠落があれば null を返す。指定外の欄は無視する。
 */
export function readStringFields<R extends string, O extends string>(
  formData: FormData,
  required: readonly R[],
  optional: readonly O[] = [],
): (Record<R, string> & Partial<Record<O, string>>) | null {
  const result: Record<string, string> = {};
  for (const key of [...required, ...optional]) {
    const values = formData.getAll(key);
    if (values.length === 0) {
      if ((required as readonly string[]).includes(key)) return null;
      continue;
    }
    if (values.length > 1 || typeof values[0] !== 'string') return null;
    result[key] = values[0];
  }
  return result as Record<R, string> & Partial<Record<O, string>>;
}

export type SignInOutcome = 'success' | 'invalid-credentials' | 'unavailable';

/**
 * Auth.jsのsignIn(redirect: false)の戻り値を分類する。
 * 資格情報の不一致を示すエラーURLだけをinvalid-credentialsとし、
 * それ以外のエラーや想定外の戻り値は成功扱いにしない。
 */
export function classifySignInResult(result: unknown): SignInOutcome {
  if (typeof result !== 'string') return 'unavailable';
  let error: string | null;
  try {
    error = new URL(result, 'http://localhost').searchParams.get('error');
  } catch {
    return 'unavailable';
  }
  if (error === null) return 'success';
  return error === 'CredentialsSignin' ? 'invalid-credentials' : 'unavailable';
}

/** Auth.jsのsignIn(redirect: false)の結果が成功を示しているか。 */
export function isSuccessfulSignIn(result: unknown): boolean {
  return classifySignInResult(result) === 'success';
}
