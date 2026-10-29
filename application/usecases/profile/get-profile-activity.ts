import type { TimelineCursor, TimelineEventKind, TimelinePage } from '@/application/dtos/timeline/timeline';
import type { ProfileQuery } from '@/application/query_service_ifs/profile/profile-query';
import { PROFILE_PAGE_SIZE } from '@/application/dtos/profile/profile';

export type GetProfileActivityResult =
  | { ok: true; page: TimelinePage }
  | { ok: false; code: 'UNAVAILABLE' };

/** 対象者の通常投稿（tweet）または対象者が実行したリツイート（retweet）を20件ずつ取得する。 */
export async function getProfileActivity(
  deps: { query: Pick<ProfileQuery, 'findActivityPage'> },
  input: { subjectId: string; viewerId: string | null; kind: TimelineEventKind; after: TimelineCursor | null },
): Promise<GetProfileActivityResult> {
  try {
    return {
      ok: true,
      page: await deps.query.findActivityPage({ ...input, limit: PROFILE_PAGE_SIZE }),
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
