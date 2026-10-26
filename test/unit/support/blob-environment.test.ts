import { describe, expect, it } from 'vitest';
import { requireTestBlobEnvironment, storeIdFromToken } from '@/test/support/blob-environment';

const token = (store: string) => `vercel_blob_rw_${store}_secretpart`;

describe('requireTestBlobEnvironment', () => {
  it('テスト用トークンが宣言したテスト用ストアを指し、アプリ用と別なら返す', () => {
    expect(
      requireTestBlobEnvironment({
        TEST_BLOB_READ_WRITE_TOKEN: token('TestStore1'),
        TEST_BLOB_STORE_ID: 'store_TestStore1',
        BLOB_READ_WRITE_TOKEN: token('AppStore1'),
        BLOB_STORE_ID: 'store_AppStore1',
      }),
    ).toEqual({ token: token('TestStore1'), storeId: 'store_TestStore1' });
  });

  it('資格情報がなければskipせずに失敗する', () => {
    expect(() => requireTestBlobEnvironment({})).toThrow('必要です');
  });

  it('トークンと宣言したストアIDが食い違えば失敗する', () => {
    expect(() =>
      requireTestBlobEnvironment({ TEST_BLOB_READ_WRITE_TOKEN: token('Other'), TEST_BLOB_STORE_ID: 'store_TestStore1' }),
    ).toThrow('指していません');
  });

  it('アプリ用のストア（ID・トークンのいずれか）と同じなら失敗する', () => {
    const test = { TEST_BLOB_READ_WRITE_TOKEN: token('Shared'), TEST_BLOB_STORE_ID: 'store_Shared' };
    expect(() => requireTestBlobEnvironment({ ...test, BLOB_STORE_ID: 'store_Shared' })).toThrow('同じ');
    expect(() => requireTestBlobEnvironment({ ...test, BLOB_READ_WRITE_TOKEN: token('Shared') })).toThrow('同じ');
  });

  it('トークンの形式でなければストアIDを取り出さない', () => {
    expect(storeIdFromToken('not-a-token')).toBeNull();
  });
});
