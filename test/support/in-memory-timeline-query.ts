import type {
  TimelinePageRequest,
  TimelineQuery,
} from '@/application/timeline/ports/timeline-query';
import type { TimelinePage } from '@/application/timeline/timeline';

/** 受け取った条件を記録し、指定したページを返すテスト用Query。 */
export class InMemoryTimelineQuery implements TimelineQuery {
  readonly requests: TimelinePageRequest[] = [];

  constructor(private page: TimelinePage = { items: [], nextCursor: null }) {}

  setPage(page: TimelinePage) {
    this.page = page;
  }

  async findPage(request: TimelinePageRequest): Promise<TimelinePage> {
    this.requests.push(request);
    return this.page;
  }
}
