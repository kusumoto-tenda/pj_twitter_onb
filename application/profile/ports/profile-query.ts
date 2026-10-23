import type { TimelineCursor, TimelineEventKind, TimelinePage } from '../../timeline/timeline';
import type {
  ConnectionCursor,
  ConnectionDirection,
  ConnectionPage,
  ProfileSummary,
} from '../profile';

/** プロフィール画面用の読み取り。取得障害はthrowする。 */
export interface ProfileQuery {
  /** 大文字小文字を区別せずに検索する。未登録ならnull。 */
  findSummary(input: { displayId: string; viewerId: string | null }): Promise<ProfileSummary | null>;
  /** tweetは対象者の通常投稿、retweetは対象者が実行したリツイート。 */
  findActivityPage(input: {
    subjectId: string;
    kind: TimelineEventKind;
    after: TimelineCursor | null;
    limit: number;
  }): Promise<TimelinePage>;
  /** followingは対象者がフォローしている人、followersは対象者をフォローしている人。 */
  findConnectionsPage(input: {
    subjectId: string;
    direction: ConnectionDirection;
    after: ConnectionCursor | null;
    limit: number;
  }): Promise<ConnectionPage>;
}
