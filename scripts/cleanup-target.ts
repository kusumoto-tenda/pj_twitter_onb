import { requireTestBlobEnvironment } from '../test/support/blob-environment';
import { assertDedicatedTestDatabase } from '../test/support/database-url';

export type CleanupTarget = { label: 'app' | 'test'; databaseUrl: string; blobToken: string };

/**
 * 回収の対象を決める。--test では、テスト用DBとテスト用Blobがアプリ用と別であることを
 * 接続前に確認する（組み合わせを誤ると、アプリの画像を「参照なし」として消してしまうため）。
 */
export function resolveCleanupTarget(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): CleanupTarget {
  if (argv.includes('--test')) {
    const databaseUrl = assertDedicatedTestDatabase(env);
    const { token } = requireTestBlobEnvironment(env);
    return { label: 'test', databaseUrl, blobToken: token };
  }
  const databaseUrl = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL;
  const blobToken = env.BLOB_READ_WRITE_TOKEN;
  if (!databaseUrl || !blobToken) throw new Error('POSTGRES_URL / BLOB_READ_WRITE_TOKEN が未設定です。');
  return { label: 'app', databaseUrl, blobToken };
}
