import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AccountDependencies } from '@/application/usecases/users/create-account';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { PostgresUserRepository } from '@/infra/persistence/postgres/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/external_services/auth/scrypt-password-hasher';

let dependencies: AccountDependencies | undefined;

/** アカウント関連の具体実装を組み立てる唯一の場所。 */
export function getAccountDependencies(): AccountDependencies {
  dependencies ??= {
    users: new PostgresUserRepository(getSql()),
    passwords: new ScryptPasswordHasher(),
    newId: randomUUID,
    now: () => new Date(),
  };
  return dependencies;
}
