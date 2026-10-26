
import postgres from 'postgres';
import { cleanupMedia } from '../application/media/cleanup-media';
import { VercelBlobStorage } from '../infra/media/vercel-blob-storage';
import { PostgresMediaRepository } from '../infra/repositories/postgres-media-repository';
import { resolveCleanupTarget, type CleanupTarget } from './cleanup-target';

// 使い方: pnpm media:cleanup        → POSTGRES_URL_NON_POOLING（なければ POSTGRES_URL）と BLOB_READ_WRITE_TOKEN
//         pnpm media:cleanup --test → TEST_POSTGRES_URL と TEST_BLOB_READ_WRITE_TOKEN（アプリ用と別であることを確認）
// Cronと同じ回収ユースケースを実行する。
for (const file of ['.env.development.local', '.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // ファイルがなければ次へ。
  }
}

let target: CleanupTarget;
try {
  target = resolveCleanupTarget(process.argv.slice(2), process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const sql = postgres(target.databaseUrl, { max: 1, onnotice: () => {} });
try {
  const result = await cleanupMedia(
    { media: new PostgresMediaRepository(sql), storage: new VercelBlobStorage(target.blobToken), now: () => new Date() },
    {},
  );
  console.log(`回収しました (${target.label}): ${JSON.stringify(result)}`);
} finally {
  await sql.end();
}

