import type { TimelineQuery } from './ports/timeline-query';
import { TIMELINE_PAGE_SIZE, type TimelineCursor, type TimelinePage } from './timeline';

export type GetTimelineInput = {
  /** セッションとDBで実在を確認した利用者のUUID。未ログインならnull。 */
  viewerId: string | null;
  followingOnly: boolean;
  after: TimelineCursor | null;
};

export type GetTimelineResult =
  | { ok: true; page: TimelinePage }
  | { ok: false; code: 'LOGIN_REQUIRED' | 'UNAVAILABLE' };

export async function getTimeline(
  deps: { query: TimelineQuery },
  { viewerId, followingOnly, after }: GetTimelineInput,
): Promise<GetTimelineResult> {
  if (followingOnly && viewerId === null) return { ok: false, code: 'LOGIN_REQUIRED' };

  try {
    const page = await deps.query.findPage({
      viewerId,
      followingOnly,
      after,
      limit: TIMELINE_PAGE_SIZE,
    });
    return { ok: true, page };
  } catch {
    // 取得障害を0件として表示しない。詳細は画面に出さない。
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
