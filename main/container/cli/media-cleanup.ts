import postgres from 'postgres';
import { VercelBlobStorage } from '@/infra/external_services/media/vercel-blob-storage';
import { PostgresMediaRepository } from '@/infra/persistence/postgres/repositories/postgres-media-repository';

/** CLIの画像回収用に具体実装を組み立てる。接続の終了は呼び出し側が行う。 */
export function createMediaCleanupDependencies(databaseUrl: string, blobToken: string) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  return {
    sql,
    dependencies: {
      media: new PostgresMediaRepository(sql),
      storage: new VercelBlobStorage(blobToken),
      now: () => new Date(),
    },
  };
}
