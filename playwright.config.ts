import { defineConfig, devices } from '@playwright/test';
import { assertDedicatedTestDatabase, loadLocalEnv } from './test/support/database-url';

// .env.local・.env の値を補完する（既存の環境変数を優先）。テスト内の検証でも同じ値を使う。
Object.assign(process.env, loadLocalEnv());
const testDatabaseUrl = assertDedicatedTestDatabase(process.env);

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'test/e2e',
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  // 実DB（遠隔のNeonなど）への初回接続とscryptを含む登録処理を待てるようにする。
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 専用のテストDBに向けた本番ビルドを起動する。開発用サーバーは使い回さない。
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      POSTGRES_URL: testDatabaseUrl,
      POSTGRES_URL_NON_POOLING: '',
      AUTH_URL: `${baseURL}/api/auth`,
      AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? 'e2e-only-secret-do-not-use-in-production',
    },
  },
});
