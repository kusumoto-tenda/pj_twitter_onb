import type { ProfileQuery } from './ports/profile-query';
import {
  PROFILE_PAGE_SIZE,
  type ConnectionCursor,
  type ConnectionDirection,
  type ConnectionPage,
} from './profile';

export type GetProfileConnectionsResult =
  | { ok: true; page: ConnectionPage }
  | { ok: false; code: 'UNAVAILABLE' };

/** 対象者のフォロー（following）またはフォロワー（followers）を20件ずつ取得する。 */
export async function getProfileConnections(
  deps: { query: Pick<ProfileQuery, 'findConnectionsPage'> },
  input: { subjectId: string; direction: ConnectionDirection; after: ConnectionCursor | null },
): Promise<GetProfileConnectionsResult> {
  try {
    return {
      ok: true,
      page: await deps.query.findConnectionsPage({ ...input, limit: PROFILE_PAGE_SIZE }),
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
