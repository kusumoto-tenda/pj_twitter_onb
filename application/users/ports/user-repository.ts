import type { ValidEditProfileInput } from '@/domain/users/profile-edit-validation';
import type { AccountProfile, StoredAccount } from '@/domain/users/user';

export type CreateUserOutcome = 'created' | 'display-id-taken';

export type UpdateProfileOutcome =
  | { status: 'updated'; profile: AccountProfile }
  | { status: 'display-id-taken' }
  | { status: 'not-found' };

export type DeleteUserOutcome = 'deleted' | 'not-found';

export interface UserRepository {
  /** 大文字小文字を区別せずにユーザーIDで検索する。 */
  findByDisplayId(displayId: string): Promise<StoredAccount | null>;
  findById(id: string): Promise<StoredAccount | null>;
  /** IDの重複だけを結果値で返し、それ以外の障害はthrowする。 */
  create(account: StoredAccount): Promise<CreateUserOutcome>;
  /**
   * 名前・ユーザーID・bioの3項目だけを更新する。
   * 他の利用者とのIDの重複と対象なしだけを結果値で返し、それ以外の障害はthrowする。
   */
  updateProfile(id: string, input: ValidEditProfileInput): Promise<UpdateProfileOutcome>;
  /**
   * 内部UUIDで利用者を削除する。投稿・フォロー・リツイートはDBのCASCADEで削除される。
   * 対象行が実際に削除された場合だけdeleted。その他のDBエラーはthrowする。
   */
  deleteById(id: string): Promise<DeleteUserOutcome>;
}
