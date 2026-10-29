import { createMigrationDependencies } from '../main/container/cli/migration';
import { resolveMigrationTarget, type MigrationTarget } from './migration-target';

// 使い方: pnpm db:migrate        → POSTGRES_URL_NON_POOLING（なければ POSTGRES_URL）に適用
//         pnpm db:migrate --test → TEST_POSTGRES_URL に適用
// Next.jsの開発時と同じ優先順位で読む。既存の環境変数は上書きしない。
// .env.development.local（開発用DB） > .env.local（`vercel env pull`） > .env
for (const file of ['.env.development.local', '.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // ファイルがなければ次へ。
  }
}

let target: MigrationTarget;
try {
  target = resolveMigrationTarget(process.argv.slice(2), process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { sql, run } = createMigrationDependencies(target.url);
try {
  const applied = await run();
  console.log(
    applied.length > 0 ? `適用しました (${target.name}): ${applied.join(', ')}` : `適用済みです (${target.name})`,
  );
} finally {
  await sql.end();
}
