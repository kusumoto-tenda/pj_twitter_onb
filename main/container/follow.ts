import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { PostgresFollowRepository } from '@/infra/persistence/postgres/repositories/postgres-follow-repository';

function build() {
  return {
    follows: new PostgresFollowRepository(getSql()),
    newId: randomUUID,
    now: () => new Date(),
  };
}

let dependencies: ReturnType<typeof build> | undefined;

/** フォロー操作の具体実装を組み立てる唯一の場所。関係一覧と件数は既存のQueryが読み取る。 */
export function getFollowDependencies() {
  dependencies ??= build();
  return dependencies;
}
