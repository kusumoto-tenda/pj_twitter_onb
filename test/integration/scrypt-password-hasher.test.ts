import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from '@/infra/external_services/auth/scrypt-password-hasher';

const hasher = new ScryptPasswordHasher();

describe('ScryptPasswordHasher', () => {
  it('hashした値を同じパスワードで照合できる', async () => {
    const hash = await hasher.hash('password123');

    expect(await hasher.verify('password123', hash)).toBe(true);
  });

  it('異なるパスワードでは照合に失敗する', async () => {
    const hash = await hasher.hash('password123');

    expect(await hasher.verify('password124', hash)).toBe(false);
    expect(await hasher.verify(' password123', hash)).toBe(false);
  });

  it('同じパスワードでもsaltが異なるため別のハッシュになり、平文を含まない', async () => {
    const first = await hasher.hash('password123');
    const second = await hasher.hash('password123');

    expect(first).not.toBe(second);
    expect(first).not.toContain('password123');
  });

  it('72バイトを超えるUnicodeパスワードの末尾の違いを区別する', async () => {
    const common = 'パ'.repeat(30); // 90バイト
    const a = `${common}あいうえお`;
    const b = `${common}あいうえか`;
    expect(Buffer.byteLength(a)).toBeGreaterThan(72);

    const hash = await hasher.hash(a);

    expect(await hasher.verify(a, hash)).toBe(true);
    expect(await hasher.verify(b, hash)).toBe(false);
  });

  it.each([
    ['空文字', ''],
    ['形式違い', 'not-a-hash'],
    ['未対応バージョン', 'scrypt$v9$17$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA'],
    ['bcrypt形式', '$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzabcde'],
  ])('壊れた保存形式（%s）は照合失敗にする', async (_label, stored) => {
    expect(await hasher.verify('password123', stored)).toBe(false);
  });

  it('保存文字列が過大な計算量を指定しても計算せず照合失敗にする', async () => {
    const hash = await hasher.hash('password123');
    const [scheme, version, , r, p, salt, key] = hash.split('$');
    const tampered = [scheme, version, '30', r, p, salt, key].join('$');

    const started = Date.now();
    expect(await hasher.verify('password123', tampered)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});
