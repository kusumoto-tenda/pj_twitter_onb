import { readdir, readFile } from 'node:fs/promises';
import type postgres from 'postgres';

/** 未適用のSQLマイグレーションをファイル名順に適用する。 */
export async function runMigrations(sql: postgres.Sql): Promise<string[]> {
  const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  await sql.begin(async (tx) => {
    // 複数プロセスから同時に実行されても一度だけ適用する。
    await tx`SELECT pg_advisory_xact_lock(hashtext('twitter.schema_migrations'))`;
    await tx`CREATE SCHEMA IF NOT EXISTS twitter`;
    await tx`
      CREATE TABLE IF NOT EXISTS twitter.schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const done = new Set(
      (await tx<{ name: string }[]>`SELECT name FROM twitter.schema_migrations`).map((r) => r.name),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8'));
      await tx`INSERT INTO twitter.schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
  });

  return applied;
}
