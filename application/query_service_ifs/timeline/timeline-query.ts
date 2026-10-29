import type { TimelineCursor, TimelinePage } from '@/application/dtos/timeline/timeline';

export type TimelinePageRequest = {
  /** trueなら、viewerがフォローしている利用者が行った出来事だけにする（viewer本人の出来事は含めない）。 */
  followingOnly: boolean;
  viewerId: string | null;
  /** このキーより古い出来事を取得する。nullなら先頭から。 */
  after: TimelineCursor | null;
  limit: number;
};

/** 画面表示用のタイムライン読み取り。取得障害はthrowする。 */
export interface TimelineQuery {
  findPage(request: TimelinePageRequest): Promise<TimelinePage>;
}
