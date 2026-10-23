import { assertDedicatedTestDatabase } from '../test/support/database-url';

export type MigrationTarget = { name: string; url: string };

/**
 * マイグレーションの適用先を決める。
 * 通常はadvisory lockを確実に使えるプールなしのURLを優先する。
 * --test では、アプリ用DBと別のDBであることを接続前に検証する。
 */
export function resolveMigrationTarget(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): MigrationTarget {
  if (argv.includes('--test')) {
    return { name: 'TEST_POSTGRES_URL', url: assertDedicatedTestDatabase(env) };
  }

  const candidates = ['POSTGRES_URL_NON_POOLING', 'POSTGRES_URL'];
  const name = candidates.find((candidate) => env[candidate]);
  if (!name) throw new Error(`${candidates.join(' / ')} が未設定です。`);
  return { name, url: env[name]! };
}
