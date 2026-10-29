import 'server-only';
import type { ProfileQuery } from '@/application/query_service_ifs/profile/profile-query';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { PostgresProfileQuery } from '@/infra/persistence/postgres/query_services/postgres-profile-query';

let dependencies: { query: ProfileQuery } | undefined;

/** プロフィール読み取りの具体実装を組み立てる唯一の場所。 */
export function getProfileDependencies(): { query: ProfileQuery } {
  dependencies ??= { query: new PostgresProfileQuery(getSql()) };
  return dependencies;
}
