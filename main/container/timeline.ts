import 'server-only';
import type { TimelineQuery } from '@/application/query_service_ifs/timeline/timeline-query';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { PostgresTimelineQuery } from '@/infra/persistence/postgres/query_services/postgres-timeline-query';

let dependencies: { query: TimelineQuery } | undefined;

/** タイムライン読み取りの具体実装を組み立てる唯一の場所。 */
export function getTimelineDependencies(): { query: TimelineQuery } {
  dependencies ??= { query: new PostgresTimelineQuery(getSql()) };
  return dependencies;
}
