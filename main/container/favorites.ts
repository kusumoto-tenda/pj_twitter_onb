import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { PostgresFavoriteQuery } from '@/infra/persistence/postgres/query_services/postgres-favorite-query';
import { PostgresFavoriteRepository } from '@/infra/persistence/postgres/repositories/postgres-favorite-repository';

function build() {
  const sql = getSql();
  return {
    favorites: new PostgresFavoriteRepository(sql),
    query: new PostgresFavoriteQuery(sql),
    newId: randomUUID,
    now: () => new Date(),
  };
}

let dependencies: ReturnType<typeof build> | undefined;

/** お気に入りの具体実装を組み立てる唯一の場所。 */
export function getFavoriteDependencies() {
  dependencies ??= build();
  return dependencies;
}
