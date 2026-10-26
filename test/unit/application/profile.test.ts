import { describe, expect, it, vi } from 'vitest';
import { getProfile } from '@/application/profile/get-profile';
import { getProfileActivity } from '@/application/profile/get-profile-activity';
import { getProfileConnections } from '@/application/profile/get-profile-connections';
import type { ProfileSummary } from '@/application/profile/profile';
import type { TimelineCursor } from '@/application/timeline/timeline';
import { InMemoryProfileQuery } from '@/test/support/in-memory-profile-query';

const subjectId = '00000000-0000-4000-8000-000000000001';
const viewerId = '00000000-0000-4000-8000-000000000002';
const summary: ProfileSummary = {
  id: subjectId,
  name: 'アリス',
  displayId: 'Alice_1',
  bio: 'こんにちは',
  createdAt: '2026-10-23T03:04:05.123456Z',
  followingCount: 2,
  followerCount: 3,
  followedByViewer: true,
};
const cursor: TimelineCursor = {
  eventAt: '2026-10-23T03:04:05.123456Z',
  kind: 'tweet',
  eventId: '00000000-0000-4000-8000-0000000000aa',
};

describe('getProfile', () => {
  it('IDとviewerIdでQueryを呼び、公開プロフィールを返す', async () => {
    const query = new InMemoryProfileQuery();
    query.summary = summary;

    const result = await getProfile({ query }, { displayId: 'ALICE_1', viewerId });

    expect(result).toEqual({ ok: true, profile: summary });
    expect(query.requests.summary).toEqual([{ displayId: 'ALICE_1', viewerId }]);
  });

  it('未登録なら NOT_FOUND を返す', async () => {
    const query = new InMemoryProfileQuery();

    expect(await getProfile({ query }, { displayId: 'Nobody_1', viewerId: null })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('DB障害は NOT_FOUND にせず UNAVAILABLE を返す', async () => {
    const findSummary = vi.fn().mockRejectedValue(new Error('db down'));

    expect(
      await getProfile({ query: { findSummary } }, { displayId: 'Alice_1', viewerId: null }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });

  it.each(['@bad', 'abcd', 'a'.repeat(16), 'ａｂｃｄｅ', 'abc de'])(
    '形式違反のID（%s）ではDBを照会しない',
    async (displayId) => {
      const findSummary = vi.fn();

      const result = await getProfile({ query: { findSummary } }, { displayId, viewerId: null });

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(findSummary).not.toHaveBeenCalled();
    },
  );
});

describe('getProfileActivity', () => {
  it('対象UUID・kind・カーソル・20件をQueryに渡す', async () => {
    const query = new InMemoryProfileQuery();
    query.activityPage = { items: [], nextCursor: cursor };

    const result = await getProfileActivity({ query }, { subjectId, viewerId: null, kind: 'retweet', after: cursor });

    expect(result).toEqual({ ok: true, page: { items: [], nextCursor: cursor } });
    expect(query.requests.activity).toEqual([{ subjectId, viewerId: null, kind: 'retweet', after: cursor, limit: 20 }]);
  });

  it('取得障害は0件にせず UNAVAILABLE を返す', async () => {
    const findActivityPage = vi.fn().mockRejectedValue(new Error('db down'));

    expect(
      await getProfileActivity({ query: { findActivityPage } }, { subjectId, viewerId: null, kind: 'tweet', after: null }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('getProfileConnections', () => {
  it('対象UUID・direction・カーソル・20件をQueryに渡す', async () => {
    const query = new InMemoryProfileQuery();
    const after = { createdAt: cursor.eventAt, relationId: cursor.eventId };

    const result = await getProfileConnections(
      { query },
      { subjectId, direction: 'followers', after },
    );

    expect(result).toEqual({ ok: true, page: { items: [], nextCursor: null } });
    expect(query.requests.connections).toEqual([
      { subjectId, direction: 'followers', after, limit: 20 },
    ]);
  });

  it('取得障害は0件にせず UNAVAILABLE を返す', async () => {
    const findConnectionsPage = vi.fn().mockRejectedValue(new Error('db down'));

    expect(
      await getProfileConnections(
        { query: { findConnectionsPage } },
        { subjectId, direction: 'following', after: null },
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
