import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { loadLocalEnv } from './test/support/database-url';

const root = fileURLToPath(new URL('.', import.meta.url));
const env = loadLocalEnv(root);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': root },
  },
  test: {
    // next-auth は拡張子なしで next/server を import するため、Viteで解決させる。
    server: { deps: { inline: ['next-auth'] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          include: ['test/unit/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['test/setup.ts', 'test/setup-dom.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/setup.ts'],
          env: {
            POSTGRES_URL: env.POSTGRES_URL ?? '',
            POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING ?? '',
            DATABASE_URL: env.DATABASE_URL ?? '',
            TEST_POSTGRES_URL: env.TEST_POSTGRES_URL ?? '',
          },
          // 実DBへの同時接続を抑え、テスト間でデータを共有しない。
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
