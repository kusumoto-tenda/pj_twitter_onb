import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * .env・.env.local（`vercel env pull` の出力）・.env.development.local（開発用DB）を
 * 後の方を優先して読み、既存の環境変数をさらに優先して返す。
 */
export function loadLocalEnv(root = '.'): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const file of ['.env', '.env.local', '.env.development.local']) {
    const path = `${root}/${file}`;
    if (existsSync(path)) Object.assign(env, parseEnv(readFileSync(path, 'utf8')));
  }
  return { ...env, ...process.env };
}

const DEFAULT_POSTGRES_PORT = '5432';

/**
 * 同じDBを指すURLか判定する。省略したポートは既定の5432として扱い、
 * Neonのプール経由（-pooler）とプールなしのURLも同じDBとみなす。
 */
export function isSameDatabase(a: string, b: string): boolean {
  try {
    const key = (url: string) => {
      const parsed = new URL(url);
      const host = parsed.hostname.replace('-pooler.', '.');
      const port = parsed.port || DEFAULT_POSTGRES_PORT;
      return `${host}:${port}${parsed.pathname}`;
    };
    return key(a) === key(b);
  } catch {
    return a === b;
  }
}

/** テストDBのURLが、アプリ用のどのURLとも別のDBを指しているか検証する。 */
export function assertDedicatedTestDatabase(env: Record<string, string | undefined>): string {
  const testUrl = env.TEST_POSTGRES_URL;
  if (!testUrl) {
    throw new Error('TEST_POSTGRES_URL が未設定です。専用のテストDBを指定してください。');
  }
  for (const name of ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL']) {
    const appUrl = env[name];
    if (appUrl && isSameDatabase(testUrl, appUrl)) {
      throw new Error(`TEST_POSTGRES_URL が ${name} と同じDBです。別のDBを指定してください。`);
    }
  }
  return testUrl;
}
