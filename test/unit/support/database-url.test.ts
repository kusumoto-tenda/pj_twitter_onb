import { describe, expect, it } from 'vitest';
import { assertDedicatedTestDatabase, isSameDatabase } from '@/test/support/database-url';

const pooled = 'postgres://u:p@ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const direct = 'postgres://u:p@ep-cool-1234.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const testBranch = 'postgres://u:p@ep-test-5678.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

describe('isSameDatabase', () => {
  it('Neonのプール経由とプールなしのURLを同じDBとみなす', () => {
    expect(isSameDatabase(pooled, direct)).toBe(true);
  });

  it('ポートの省略と既定の5432を同じDBとみなす', () => {
    expect(isSameDatabase('postgres://u:p@localhost/app', 'postgres://u:p@localhost:5432/app')).toBe(
      true,
    );
    expect(isSameDatabase(pooled, pooled.replace('.tech/', '.tech:5432/'))).toBe(true);
  });

  it('ポートが異なれば別のDBとみなす', () => {
    expect(isSameDatabase('postgres://u:p@localhost/app', 'postgres://u:p@localhost:5433/app')).toBe(
      false,
    );
  });

  it('別のホスト・別のDB名なら別のDBとみなす', () => {
    expect(isSameDatabase(pooled, testBranch)).toBe(false);
    expect(isSameDatabase(direct, direct.replace('/neondb', '/neondb_test'))).toBe(false);
  });
});

describe('assertDedicatedTestDatabase', () => {
  it('未設定なら失敗する', () => {
    expect(() => assertDedicatedTestDatabase({ POSTGRES_URL: pooled })).toThrow('未設定');
  });

  it('アプリ用のいずれかのURLと同じDBなら失敗する', () => {
    expect(() =>
      assertDedicatedTestDatabase({ POSTGRES_URL: pooled, TEST_POSTGRES_URL: direct }),
    ).toThrow('POSTGRES_URL');
    expect(() =>
      assertDedicatedTestDatabase({ POSTGRES_URL_NON_POOLING: direct, TEST_POSTGRES_URL: pooled }),
    ).toThrow('POSTGRES_URL_NON_POOLING');
  });

  it('別のDBならそのURLを返す', () => {
    expect(
      assertDedicatedTestDatabase({ POSTGRES_URL: pooled, TEST_POSTGRES_URL: testBranch }),
    ).toBe(testBranch);
  });
});
