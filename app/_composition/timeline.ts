import 'server-only';
import type { TimelineQuery } from '@/application/timeline/ports/timeline-query';
import { getSql } from '@/infra/db/client';
import { PostgresTimelineQuery } from '@/infra/queries/postgres-timeline-query';

let dependencies: { query: TimelineQuery } | undefined;

/** タイムライン読み取りの具体実装を組み立てる唯一の場所。 */
export function getTimelineDependencies(): { query: TimelineQuery } {
  dependencies ??= { query: new PostgresTimelineQuery(getSql()) };
  return dependencies;
}
