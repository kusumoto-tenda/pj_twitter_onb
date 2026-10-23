import type { ProfileQuery } from '@/application/profile/ports/profile-query';
import type { ConnectionPage, ProfileSummary } from '@/application/profile/profile';
import type { TimelinePage } from '@/application/timeline/timeline';

type Requests = {
  summary: Parameters<ProfileQuery['findSummary']>[0][];
  activity: Parameters<ProfileQuery['findActivityPage']>[0][];
  connections: Parameters<ProfileQuery['findConnectionsPage']>[0][];
};

/** 受け取った条件を記録し、指定した結果を返すテスト用Query。 */
export class InMemoryProfileQuery implements ProfileQuery {
  readonly requests: Requests = { summary: [], activity: [], connections: [] };
  summary: ProfileSummary | null = null;
  activityPage: TimelinePage = { items: [], nextCursor: null };
  connectionPage: ConnectionPage = { items: [], nextCursor: null };

  async findSummary(input: Requests['summary'][number]) {
    this.requests.summary.push(input);
    return this.summary;
  }

  async findActivityPage(input: Requests['activity'][number]) {
    this.requests.activity.push(input);
    return this.activityPage;
  }

  async findConnectionsPage(input: Requests['connections'][number]) {
    this.requests.connections.push(input);
    return this.connectionPage;
  }
}
