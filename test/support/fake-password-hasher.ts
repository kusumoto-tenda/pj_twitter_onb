import type { PasswordHasher } from '@/application/users/ports/password-hasher';

/** テスト用。安全性はなく、平文を識別できる固定形式の文字列を返す。 */
export class FakePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `fake-hash:${password}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    return hash === `fake-hash:${password}`;
  }
}
