import { describe, expect, it } from 'vitest';
import { resolveCleanupTarget } from '@/scripts/cleanup-target';

const blobToken = (store: string) => `vercel_blob_rw_${store}_secret`;
const APP = {
  POSTGRES_URL: 'postgres://u:p@ep-app-1-pooler.neon.tech/neondb',
  BLOB_READ_WRITE_TOKEN: blobToken('AppStore'),
  BLOB_STORE_ID: 'store_AppStore',
};
const TEST = {
  TEST_POSTGRES_URL: 'postgres://u:p@ep-test-2.neon.tech/neondb',
  TEST_BLOB_READ_WRITE_TOKEN: blobToken('TestStore'),
  TEST_BLOB_STORE_ID: 'store_TestStore',
};

describe('resolveCleanupTarget', () => {
  it('通常はアプリ用のDBとBlobを対象にする', () => {
    expect(resolveCleanupTarget([], { ...APP, ...TEST })).toEqual({
      label: 'app',
      databaseUrl: APP.POSTGRES_URL,
      blobToken: APP.BLOB_READ_WRITE_TOKEN,
    });
  });

  it('--test では、分離を確認したテスト用のDBとBlobを対象にする', () => {
    expect(resolveCleanupTarget(['--test'], { ...APP, ...TEST })).toEqual({
      label: 'test',
      databaseUrl: TEST.TEST_POSTGRES_URL,
      blobToken: TEST.TEST_BLOB_READ_WRITE_TOKEN,
    });
  });

  it('--test でテスト用Blobがアプリ用のストアを指していれば、接続前に失敗する（本番画像を消さない）', () => {
    expect(() =>
      resolveCleanupTarget(['--test'], {
        ...APP,
        ...TEST,
        TEST_BLOB_READ_WRITE_TOKEN: APP.BLOB_READ_WRITE_TOKEN,
        TEST_BLOB_STORE_ID: APP.BLOB_STORE_ID,
      }),
    ).toThrow('同じ');
  });

  it('--test でテスト用のトークンと宣言したストアが食い違えば失敗する', () => {
    expect(() =>
      resolveCleanupTarget(['--test'], { ...APP, ...TEST, TEST_BLOB_READ_WRITE_TOKEN: APP.BLOB_READ_WRITE_TOKEN }),
    ).toThrow();
  });

  it('--test でテスト用DBがアプリ用DBと同じなら失敗する', () => {
    expect(() =>
      resolveCleanupTarget(['--test'], {
        ...APP,
        ...TEST,
        TEST_POSTGRES_URL: 'postgres://u:p@ep-app-1.neon.tech/neondb',
      }),
    ).toThrow('同じDB');
  });

  it('資格情報がなければ失敗する', () => {
    expect(() => resolveCleanupTarget([], {})).toThrow('未設定');
    expect(() => resolveCleanupTarget(['--test'], APP)).toThrow();
  });
});
