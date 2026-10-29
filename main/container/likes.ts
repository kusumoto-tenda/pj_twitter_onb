import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { PostgresLikeRepository } from '@/infra/persistence/postgres/repositories/postgres-like-repository';

function build() {
  return {
    likes: new PostgresLikeRepository(getSql()),
    newId: randomUUID,
    now: () => new Date(),
  };
}

let dependencies: ReturnType<typeof build> | undefined;

/** いいねの具体実装を組み立てる唯一の場所。公開一覧の読み取りはプロフィールのQueryが担う。 */
export function getLikeDependencies() {
  dependencies ??= build();
  return dependencies;
}
