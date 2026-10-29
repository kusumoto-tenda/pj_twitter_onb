import type { ProfileLikesQuery, ProfileQuery } from '@/application/query_service_ifs/profile/profile-query';
import type { ConnectionPage, ProfileLikesPage, ProfileSummary } from '@/application/dtos/profile/profile';
import type { TimelinePage } from '@/application/dtos/timeline/timeline';

type Requests = {
  summary: Parameters<ProfileQuery['findSummary']>[0][];
  activity: Parameters<ProfileQuery['findActivityPage']>[0][];
  connections: Parameters<ProfileQuery['findConnectionsPage']>[0][];
  liked: Parameters<ProfileLikesQuery['findLikedPage']>[0][];
};

/** 受け取った条件を記録し、指定した結果を返すテスト用Query。 */
export class InMemoryProfileQuery implements ProfileQuery {
  readonly requests: Requests = { summary: [], activity: [], connections: [], liked: [] };
  summary: ProfileSummary | null = null;
  activityPage: TimelinePage = { items: [], nextCursor: null };
  connectionPage: ConnectionPage = { items: [], nextCursor: null };
  likedPage: ProfileLikesPage = { items: [], nextCursor: null };

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

  async findLikedPage(input: Requests['liked'][number]) {
    this.requests.liked.push(input);
    return this.likedPage;
  }
}
