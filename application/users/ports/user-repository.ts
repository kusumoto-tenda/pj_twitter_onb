import type { StoredAccount } from '@/domain/users/user';

export type CreateUserOutcome = 'created' | 'display-id-taken';

export interface UserRepository {
  /** 大文字小文字を区別せずにユーザーIDで検索する。 */
  findByDisplayId(displayId: string): Promise<StoredAccount | null>;
  findById(id: string): Promise<StoredAccount | null>;
  /** IDの重複だけを結果値で返し、それ以外の障害はthrowする。 */
  create(account: StoredAccount): Promise<CreateUserOutcome>;
}
