import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { PasswordHasher } from '@/domain/external_service_ifs/auth/password-hasher';

// 保存形式: scrypt$v1$<log2N>$<r>$<p>$<salt(base64url)>$<key(base64url)>
const SCHEME = 'scrypt';
const VERSION = 'v1';
const LOG2_N = 17; // N = 131072
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

// 保存文字列に任意の計算量を指定されても無制限に実行しないための上限。
const ALLOWED_LOG2_N = { min: 14, max: LOG2_N };

function deriveKey(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

type ParsedHash = { log2N: number; salt: Buffer; key: Buffer };

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 7) return null;
  const [scheme, version, log2N, r, p, salt, key] = parts;
  if (scheme !== SCHEME || version !== VERSION) return null;
  if (!/^\d+$/.test(log2N) || r !== String(BLOCK_SIZE) || p !== String(PARALLELIZATION)) return null;
  const n = Number(log2N);
  if (n < ALLOWED_LOG2_N.min || n > ALLOWED_LOG2_N.max) return null;
  const saltBuf = Buffer.from(salt, 'base64url');
  const keyBuf = Buffer.from(key, 'base64url');
  if (saltBuf.length < SALT_BYTES || keyBuf.length !== KEY_BYTES) return null;
  return { log2N: n, salt: saltBuf, key: keyBuf };
}

function options(log2N: number): ScryptOptions {
  return { N: 2 ** log2N, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAX_MEMORY };
}

/** Node.js標準の非同期scryptによるハッシュ。bcryptと違い72バイトを超える入力も全体を使う。 */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt, options(LOG2_N));
    return [
      SCHEME,
      VERSION,
      LOG2_N,
      BLOCK_SIZE,
      PARALLELIZATION,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    const key = await deriveKey(password, parsed.salt, options(parsed.log2N));
    return timingSafeEqual(key, parsed.key);
  }
}
