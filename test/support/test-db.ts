import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { assertDedicatedTestDatabase } from './database-url';

/** 本番用と別の専用テストDBのURLを返す。未設定・同一なら実行前に失敗させる。 */
export function requireTestDatabaseUrl(): string {
  return assertDedicatedTestDatabase(process.env);
}

export async function connectTestDatabase() {
  const sql = postgres(requireTestDatabaseUrl(), { max: 5, onnotice: () => {} });
  // E2E（PlaywrightのCJS変換）からは読み込まないよう、必要時にだけimportする。
  const { runMigrations } = await import('@/infra/db/migrate');
  await runMigrations(sql);
  return sql;
}

/** テストごとに一意なユーザーID（5〜15文字）。 */
export function uniqueDisplayId(prefix = 'T'): string {
  return `${prefix}${randomBytes(5).toString('hex')}`.slice(0, 15);
}

/** テストで作成した行だけを、大文字小文字を区別しないユーザーIDで削除する。 */
export async function deleteUsersByDisplayIds(sql: postgres.Sql, displayIds: string[]) {
  if (displayIds.length === 0) return;
  const keys = displayIds.map((id) => id.toLowerCase());
  await sql`DELETE FROM twitter.users WHERE lower(display_id) = ANY(${keys})`;
}
