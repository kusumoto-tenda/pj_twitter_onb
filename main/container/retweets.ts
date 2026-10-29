import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { PostgresRetweetRepository } from '@/infra/persistence/postgres/repositories/postgres-retweet-repository';

function build() {
  return {
    retweets: new PostgresRetweetRepository(getSql()),
    newId: randomUUID,
    now: () => new Date(),
  };
}

let dependencies: ReturnType<typeof build> | undefined;

/** リツイート操作の具体実装を組み立てる唯一の場所。一覧の読み取りはタイムライン・プロフィールのQueryが担う。 */
export function getRetweetDependencies() {
  dependencies ??= build();
  return dependencies;
}
