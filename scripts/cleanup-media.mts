
import postgres from 'postgres';
import { cleanupMedia } from '../application/media/cleanup-media';
import { VercelBlobStorage } from '../infra/media/vercel-blob-storage';
import { PostgresMediaRepository } from '../infra/repositories/postgres-media-repository';

// 使い方: pnpm media:cleanup        → POSTGRES_URL と BLOB_READ_WRITE_TOKEN を対象に回収
//         pnpm media:cleanup --test → TEST_POSTGRES_URL と TEST_BLOB_READ_WRITE_TOKEN を対象に回収
// Cronと同じ回収ユースケースを実行する。
for (const file of ['.env.development.local', '.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // ファイルがなければ次へ。
  }
}

const useTest = process.argv.includes('--test');
const databaseUrl = useTest ? process.env.TEST_POSTGRES_URL : process.env.POSTGRES_URL;
const blobToken = useTest ? process.env.TEST_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN;
if (!databaseUrl || !blobToken) {
  console.error(useTest ? 'TEST_POSTGRES_URL / TEST_BLOB_READ_WRITE_TOKEN が未設定です。' : 'POSTGRES_URL / BLOB_READ_WRITE_TOKEN が未設定です。');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
try {
  const result = await cleanupMedia(
    { media: new PostgresMediaRepository(sql), storage: new VercelBlobStorage(blobToken), now: () => new Date() },
    {},
  );
  console.log(`回収しました (${useTest ? 'test' : 'app'}): ${JSON.stringify(result)}`);
} finally {
  await sql.end();
}

