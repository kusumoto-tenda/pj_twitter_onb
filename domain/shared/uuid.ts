const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUIDなら小文字に揃えて返す。それ以外（前後の空白を含む）はnull。 */
export function normalizeUuid(value: string): string | null {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}
