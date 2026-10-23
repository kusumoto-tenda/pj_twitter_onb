/** URLのカーソル文字列の上限。これを超える値はデコードしない。 */
export const MAX_CURSOR_LENGTH = 512;

export type SearchParamValue = string | string[] | undefined;

const UTC_MICROS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 実在する日時で、DBと同じ小数秒6桁のUTC表記か。 */
export function isUtcMicros(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_MICROS_PATTERN.test(value)) return false;
  // 年0000はJSでは有効だがPostgreSQLでは扱えないため拒否する。
  if (value.startsWith('0000-')) return false;
  const date = new Date(`${value.slice(0, 23)}Z`);
  // 2026-02-30 のような値はDateが繰り上げるため、往復した表記と比べて弾く。
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** 値の配列をURLに載せるカーソル文字列にする。 */
export function encodeCursorParts(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

/**
 * カーソル文字列を指定した要素数の配列へデコードする。
 * 未指定はnull、不正な値（重複パラメータ・長すぎる・壊れたBase64/JSON・要素数違い）はundefined。
 * 各要素の意味の検証は呼び出し側で行う。
 */
export function decodeCursorParts(
  value: SearchParamValue,
  length: number,
): unknown[] | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CURSOR_LENGTH) {
    return undefined;
  }
  if (!BASE64URL_PATTERN.test(value)) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(decoded) || decoded.length !== length) return undefined;
  return decoded;
}
