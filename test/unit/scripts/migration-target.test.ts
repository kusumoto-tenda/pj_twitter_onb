import { describe, expect, it } from 'vitest';
import { resolveMigrationTarget } from '@/scripts/migration-target';

const app = 'postgres://u:p@ep-app-1-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
const appDirect = 'postgres://u:p@ep-app-1.us-east-1.aws.neon.tech/neondb?sslmode=require';
const test = 'postgres://u:p@ep-test-2.us-east-1.aws.neon.tech/neondb?sslmode=require';

describe('resolveMigrationTarget', () => {
  it('通常はプールなしのURLを優先する', () => {
    expect(
      resolveMigrationTarget([], { POSTGRES_URL: app, POSTGRES_URL_NON_POOLING: appDirect }),
    ).toEqual({ name: 'POSTGRES_URL_NON_POOLING', url: appDirect });
  });

  it('プールなしのURLがなければ POSTGRES_URL を使う', () => {
    expect(resolveMigrationTarget([], { POSTGRES_URL: app })).toEqual({
      name: 'POSTGRES_URL',
      url: app,
    });
  });

  it('アプリ用のURLが未設定なら失敗する', () => {
    expect(() => resolveMigrationTarget([], {})).toThrow('未設定');
  });

  it('--test では専用のテストDBを使う', () => {
    expect(
      resolveMigrationTarget(['--test'], { POSTGRES_URL: app, TEST_POSTGRES_URL: test }),
    ).toEqual({ name: 'TEST_POSTGRES_URL', url: test });
  });

  it('--test でテストDBがアプリ用DBと同じなら、接続前に失敗する', () => {
    expect(() =>
      resolveMigrationTarget(['--test'], { POSTGRES_URL: app, TEST_POSTGRES_URL: appDirect }),
    ).toThrow('同じDB');
    expect(() =>
      resolveMigrationTarget(['--test'], {
        POSTGRES_URL_NON_POOLING: 'postgres://u:p@localhost:5432/app',
        TEST_POSTGRES_URL: 'postgres://u:p@localhost/app',
      }),
    ).toThrow('同じDB');
  });

  it('--test でテストDBが未設定なら失敗する', () => {
    expect(() => resolveMigrationTarget(['--test'], { POSTGRES_URL: app })).toThrow('未設定');
  });
});
