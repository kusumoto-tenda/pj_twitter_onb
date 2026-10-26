import { describe, expect, it, vi } from 'vitest';
import { getTimeline } from '@/application/timeline/get-timeline';
import type { TimelineCursor, TimelinePage } from '@/application/timeline/timeline';
import { InMemoryTimelineQuery } from '@/test/support/in-memory-timeline-query';

const viewerId = '00000000-0000-4000-8000-000000000001';
const cursor: TimelineCursor = {
  eventAt: '2026-10-23T03:04:05.123456Z',
  kind: 'retweet',
  eventId: '00000000-0000-4000-8000-0000000000aa',
};
const page: TimelinePage = {
  items: [
    {
      key: cursor,
      tweet: {
        id: '00000000-0000-4000-8000-0000000000bb',
        content: 'こんにちは',
        author: { id: viewerId, name: 'アリス', displayId: 'Alice_1' },
        createdAt: '2026-10-23T03:00:00.000000Z',
        images: [],
        favoritedByViewer: false,
      },
      retweetedBy: null,
    },
  ],
  nextCursor: cursor,
};

describe('getTimeline', () => {
  it('viewerId・followingOnly・カーソル・limit=20をQueryに渡して結果を返す', async () => {
    const query = new InMemoryTimelineQuery(page);

    const result = await getTimeline({ query }, { viewerId, followingOnly: true, after: cursor });

    expect(result).toEqual({ ok: true, page });
    expect(query.requests).toEqual([{ viewerId, followingOnly: true, after: cursor, limit: 20 }]);
  });

  it('未ログインでも全体一覧は取得できる', async () => {
    const query = new InMemoryTimelineQuery(page);

    const result = await getTimeline({ query }, { viewerId: null, followingOnly: false, after: null });

    expect(result).toEqual({ ok: true, page });
    expect(query.requests[0]).toMatchObject({ viewerId: null, followingOnly: false, after: null });
  });

  it('フォロー一覧にはログインが必要で、未認証ならDBを照会しない', async () => {
    const findPage = vi.fn();

    const result = await getTimeline(
      { query: { findPage } },
      { viewerId: null, followingOnly: true, after: null },
    );

    expect(result).toEqual({ ok: false, code: 'LOGIN_REQUIRED' });
    expect(findPage).not.toHaveBeenCalled();
  });

  it('Queryの障害は0件にせず UNAVAILABLE を返す', async () => {
    const findPage = vi.fn().mockRejectedValue(new Error('db down'));

    const result = await getTimeline(
      { query: { findPage } },
      { viewerId, followingOnly: false, after: null },
    );

    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
