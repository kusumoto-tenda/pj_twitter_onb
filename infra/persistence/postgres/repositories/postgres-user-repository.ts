import postgres from 'postgres';
import type {
  CreateUserOutcome,
  DeleteUserOutcome,
  UpdateProfileOutcome,
  UserRepository,
} from '@/domain/repository_ifs/user-repository';
import { normalizeDisplayId } from '@/domain/value_objects/users/account-validation';
import type { ValidEditProfileInput } from '@/domain/value_objects/users/profile-edit-validation';
import type { StoredAccount } from '@/domain/entities/users/user';

type UserRow = {
  id: string;
  name: string;
  display_id: string;
  bio: string;
  password_hash: string;
  created_at: Date;
};

/** ユーザーIDの一意インデックスの違反だけを重複として扱う。他の制約違反や障害は含めない。 */
function isDisplayIdConflict(error: unknown): boolean {
  return (
    error instanceof postgres.PostgresError &&
    error.code === '23505' &&
    error.constraint_name === 'users_display_id_ci_unique'
  );
}

function toAccount(row: UserRow): StoredAccount {
  return {
    id: row.id,
    name: row.name,
    displayId: row.display_id,
    bio: row.bio,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async findByDisplayId(displayId: string): Promise<StoredAccount | null> {
    const rows = await this.sql<UserRow[]>`
      SELECT id, name, display_id, bio, password_hash, created_at
      FROM twitter.users
      WHERE lower(display_id) = ${normalizeDisplayId(displayId)}
    `;
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async findById(id: string): Promise<StoredAccount | null> {
    const rows = await this.sql<UserRow[]>`
      SELECT id, name, display_id, bio, password_hash, created_at
      FROM twitter.users
      WHERE id = ${id}
    `;
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async create(account: StoredAccount): Promise<CreateUserOutcome> {
    // 同時登録でもDBの一意インデックスが最終判断する。競合以外のエラーはそのままthrowする。
    const rows = await this.sql`
      INSERT INTO twitter.users (id, name, display_id, bio, password_hash, created_at)
      VALUES (
        ${account.id}, ${account.name}, ${account.displayId}, ${account.bio},
        ${account.passwordHash}, ${account.createdAt}
      )
      ON CONFLICT (lower(display_id)) DO NOTHING
      RETURNING id
    `;
    return rows.length === 1 ? 'created' : 'display-id-taken';
  }

  async updateProfile(id: string, input: ValidEditProfileInput): Promise<UpdateProfileOutcome> {
    try {
      // 3項目を1つのUPDATEで更新する。一意制約違反なら文全体が失敗し、部分的に変わらない。
      const rows = await this.sql<Omit<UserRow, 'password_hash'>[]>`
        UPDATE twitter.users
        SET name = ${input.name}, display_id = ${input.displayId}, bio = ${input.bio}
        WHERE id = ${id}
        RETURNING id, name, display_id, bio, created_at
      `;
      const row = rows[0];
      if (!row) return { status: 'not-found' };
      return {
        status: 'updated',
        profile: {
          id: row.id,
          name: row.name,
          displayId: row.display_id,
          bio: row.bio,
          createdAt: row.created_at,
        },
      };
    } catch (error) {
      if (isDisplayIdConflict(error)) return { status: 'display-id-taken' };
      throw error;
    }
  }

  async deleteById(id: string): Promise<DeleteUserOutcome> {
    // 単一のDELETEで本人の行を消し、投稿・フォロー・リツイートは既存FKのCASCADEに任せる。
    const rows = await this.sql`DELETE FROM twitter.users WHERE id = ${id} RETURNING id`;
    return rows.length === 1 ? 'deleted' : 'not-found';
  }
}
