
import { cleanupMedia } from '../application/usecases/media/cleanup-media';
import { createMediaCleanupDependencies } from '../main/container/cli/media-cleanup';
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

const { sql, dependencies } = createMediaCleanupDependencies(target.databaseUrl, target.blobToken);
try {
  const result = await cleanupMedia(dependencies, {});
  console.log(`回収しました (${target.label}): ${JSON.stringify(result)}`);
} finally {
  await sql.end();
}

