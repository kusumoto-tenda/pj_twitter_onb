import postgres from 'postgres';
import { runMigrations } from '@/infra/persistence/postgres/db/migrate';

/** CLIのmigration用に接続と実行関数を組み立てる。接続の終了は呼び出し側が行う。 */
export function createMigrationDependencies(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  return { sql, run: () => runMigrations(sql) };
}
