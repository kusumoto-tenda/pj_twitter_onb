/** 通知Cookieが指定の値なら削除してtrueを返す。一度しか消費できない。 */
export function consumeFlashCookie(name: string, expected: string): boolean {
  const found = document.cookie
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === `${name}=${expected}`);
  if (found) document.cookie = `${name}=; path=/; max-age=0`;
  return found;
}
