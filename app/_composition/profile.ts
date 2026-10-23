import 'server-only';
import type { ProfileQuery } from '@/application/profile/ports/profile-query';
import { getSql } from '@/infra/db/client';
import { PostgresProfileQuery } from '@/infra/queries/postgres-profile-query';

let dependencies: { query: ProfileQuery } | undefined;

/** プロフィール読み取りの具体実装を組み立てる唯一の場所。 */
export function getProfileDependencies(): { query: ProfileQuery } {
  dependencies ??= { query: new PostgresProfileQuery(getSql()) };
  return dependencies;
}
