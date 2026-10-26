import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileSummary } from '@/application/profile/profile';
import type { TimelineCursor, TimelineItem } from '@/application/timeline/timeline';
import { createAccount } from '@/application/users/create-account';
import {
  encodeActivityCursor,
  encodeConnectionCursor,
  encodeLikeCursor,
} from '@/app/lib/profile-query';
import { encodeCursor } from '@/app/lib/timeline-query';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { InMemoryProfileQuery } from '@/test/support/in-memory-profile-query';

const boundary = vi.hoisted(() => ({
  session: null as unknown,
  accountDeps: undefined as unknown,
  profileDeps: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// ページの振る舞いのテストなので、投稿ボタン（ルートlayoutのProviderが必要）は空にする。
// 三点メニュー（ルートlayoutのProviderが必要）は、表示の有無が分かる目印にする。
// お気に入りボタン（ルートlayoutのProviderが必要）は、渡された値が分かる目印にする。
vi.mock('@/app/ui/favorites/favorite-button', () => ({
  FavoriteButton: ({ tweetId, active, expectedActorId }: { tweetId: string; active: boolean; expectedActorId: string | null }) => (
    <span data-testid="favorite-button" data-tweet={tweetId} data-active={String(active)} data-actor={expectedActorId ?? ''} />
  ),
}));
// いいねボタン（ルートlayoutのProviderが必要）は、渡された値が分かる目印にする。
vi.mock('@/app/ui/likes/like-button', () => ({
  LikeButton: ({ tweetId, active, count }: { tweetId: string; active: boolean; count: number }) => (
    <span data-testid="like-button" data-tweet={tweetId} data-active={String(active)} data-count={count} />
  ),
}));
vi.mock('@/app/ui/tweets/tweet-actions-menu', () => ({
  TweetActionsMenu: ({ tweetId }: { tweetId: string }) => <span data-testid="tweet-menu">{tweetId}</span>,
}));
vi.mock('@/app/ui/tweets/create-tweet-launcher', () => ({ CreateTweetLauncher: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/app/_composition/account', () => ({
  getAccountDependencies: () => boundary.accountDeps,
}));
vi.mock('@/app/_composition/profile', () => ({
  getProfileDependencies: () => boundary.profileDeps,
}));

const { default: ProfilePage, metadata } = await import('@/app/profile/[displayId]/page');

const OTHER_ID = '00000000-0000-4000-8000-0000000000b0';
const other: ProfileSummary = {
  id: OTHER_ID,
  name: 'ボブ',
  displayId: 'Bob_12',
  bio: '',
  createdAt: '2026-10-23T03:04:05.123456Z',
  followingCount: 4,
  followerCount: 5,
  followedByViewer: true,
};
const cursor: TimelineCursor = {
  eventAt: '2026-10-23T03:04:05.123456Z',
  kind: 'tweet',
  eventId: '00000000-0000-4000-8000-0000000000aa',
};
const item: TimelineItem = {
  key: cursor,
  tweet: {
    id: cursor.eventId,
    content: 'ボブの投稿',
    author: { id: OTHER_ID, name: 'ボブ', displayId: 'Bob_12' },
    createdAt: cursor.eventAt,
    images: [],
    favoritedByViewer: false,
    likedByViewer: false,
    likeCount: 0,
    retweetedByViewer: false,
    retweetCount: 0,
  },
  retweetedBy: null,
};

let accounts: ReturnType<typeof createTestDependencies>;
let query: InMemoryProfileQuery;

function signIn(id = FIXED_ID) {
  boundary.session = { user: { id }, expires: '2099-01-01T00:00:00Z' };
}

function page(displayId: string, searchParams: Record<string, string | string[] | undefined> = {}) {
  return ProfilePage({
    params: Promise.resolve({ displayId }),
    searchParams: Promise.resolve(searchParams),
  });
}

async function renderPage(...args: Parameters<typeof page>) {
  render(await page(...args));
}

beforeEach(async () => {
  accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput);
  query = new InMemoryProfileQuery();
  query.summary = other;
  query.activityPage = { items: [item], nextCursor: null };
  boundary.accountDeps = accounts.deps;
  boundary.profileDeps = { query };
  boundary.session = null;
});

describe('ProfilePage', () => {
  it('未ログインでも公開プロフィールと投稿を表示し、ログインを要求しない', async () => {
    await renderPage('Bob_12');

    expect(query.requests.summary).toEqual([{ displayId: 'Bob_12', viewerId: null }]);
    expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('ボブの投稿');
    expect(query.requests.activity).toEqual([
      { subjectId: OTHER_ID, viewerId: null, kind: 'tweet', after: null, limit: 20 },
    ]);
    expect(screen.queryByRole('link', { name: 'プロフィール' })).not.toBeInTheDocument();
    expect(metadata).toMatchObject({ title: 'プロフィール' });
  });

  it('ログイン中に他人を見ると、他人として表示し、自分のナビは自分のIDを指す', async () => {
    signIn();

    await renderPage('Bob_12');

    expect(query.requests.summary[0]).toMatchObject({ viewerId: FIXED_ID });
    // 一覧の対象は表示中の他人、お気に入りの判定はログイン中の自分
    expect(query.requests.activity[0]).toMatchObject({ subjectId: OTHER_ID, viewerId: FIXED_ID });
    expect(screen.queryByText('自分のプロフィール')).not.toBeInTheDocument();
    expect(screen.getByText('フォロー中')).toBeInTheDocument();
    const nav = screen.getByRole('link', { name: 'プロフィール' });
    expect(nav).toHaveAttribute('href', '/profile/Alice_1');
    expect(nav).not.toHaveAttribute('aria-current');
  });

  it('対象UUIDがセッションと一致すれば、URLの大小文字が違っても自分として表示する', async () => {
    signIn();
    query.summary = { ...other, id: FIXED_ID, name: 'アリス', displayId: 'Alice_1' };

    await renderPage('ALICE_1');

    expect(screen.getByText('自分のプロフィール')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'プロフィール' })).toHaveAttribute('aria-current', 'page');
    // 生成するリンクは保存済みの表記を使う
    expect(screen.getByRole('link', { name: 'リツイート' })).toHaveAttribute(
      'href',
      '/profile/Alice_1?tab=retweets',
    );
  });

  it('未登録なら一覧を取得せず notFound にする', async () => {
    query.summary = null;

    await expect(page('Nobody_1')).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(query.requests.activity).toEqual([]);
  });

  it('形式違反のIDはDBを照会せず notFound にする', async () => {
    await expect(page('@bad')).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(query.requests.summary).toEqual([]);
  });

  it('プロフィールの取得障害は404にせず、再試行を表示する', async () => {
    vi.spyOn(query, 'findSummary').mockRejectedValue(new Error('db down: secret-host'));

    await renderPage('Bob_12');

    expect(screen.getByText('プロフィールを取得できませんでした')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret-host');
    expect(query.requests.activity).toEqual([]);
  });

  it('投稿0件でもヘッダーと空一覧を表示する', async () => {
    query.activityPage = { items: [], nextCursor: null };

    await renderPage('Bob_12');

    expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
    expect(screen.getByText('まだ投稿がありません')).toBeInTheDocument();
  });

  it('閲覧者本人の投稿にだけ三点メニューを出す（他人のプロフィールでは出さない）', async () => {
    signIn();
    await renderPage('Bob_12');
    expect(screen.queryByTestId('tweet-menu')).not.toBeInTheDocument();
  });

  it('自分の投稿には三点メニューを出す', async () => {
    signIn();
    query.summary = { ...other, id: FIXED_ID, name: 'アリス', displayId: 'Alice_1' };
    query.activityPage = {
      items: [{ ...item, tweet: { ...item.tweet, author: { id: FIXED_ID, name: 'アリス', displayId: 'Alice_1' } } }],
      nextCursor: null,
    };

    await renderPage('Alice_1');

    expect(screen.getByTestId('tweet-menu')).toHaveTextContent(item.tweet.id);
  });

  it('リツイートタブは対象者のリツイートを取得する', async () => {
    await renderPage('Bob_12', { tab: 'retweets' });

    expect(query.requests.activity[0]).toMatchObject({ subjectId: OTHER_ID, kind: 'retweet' });
    expect(screen.getByRole('link', { name: 'リツイート' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['following', 'フォロー中のユーザー'],
    ['followers', 'フォロワー'],
  ] as const)('%sタブは関係一覧を向きどおりに取得する', async (tab, listName) => {
    query.connectionPage = {
      items: [{ id: FIXED_ID, name: 'アリス', displayId: 'Alice_1' }],
      nextCursor: null,
    };

    await renderPage('Bob_12', { tab });

    expect(query.requests.connections).toEqual([
      { subjectId: OTHER_ID, direction: tab, after: null, limit: 20 },
    ]);
    expect(query.requests.activity).toEqual([]);
    expect(screen.getByRole('list', { name: listName })).toHaveTextContent('アリス');
  });

  it('有効なカーソルを渡し、対象IDとタブを保った「次の20件」「最新に戻る」を表示する', async () => {
    const next = { createdAt: cursor.eventAt, relationId: '00000000-0000-4000-8000-0000000000cc' };
    query.connectionPage = { items: [], nextCursor: next };
    const current = encodeConnectionCursor(OTHER_ID, 'followers', {
      createdAt: cursor.eventAt,
      relationId: '00000000-0000-4000-8000-0000000000dd',
    });

    await renderPage('BOB_12', { tab: 'followers', cursor: current });

    expect(query.requests.connections[0].after).toEqual({
      createdAt: cursor.eventAt,
      relationId: '00000000-0000-4000-8000-0000000000dd',
    });
    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute(
      'href',
      '/profile/Bob_12?tab=followers',
    );
    const nextHref = new URL(
      screen.getByRole('link', { name: '次の20件' }).getAttribute('href')!,
      'http://x',
    );
    expect(nextHref.pathname).toBe('/profile/Bob_12');
    expect(nextHref.searchParams.get('tab')).toBe('followers');
    expect(nextHref.searchParams.get('cursor')).toBe(
      encodeConnectionCursor(OTHER_ID, 'followers', next),
    );
  });

  it.each([
    ['壊れた値', 'broken!!'],
    ['メイン画面のカーソル', encodeCursor(cursor)],
    ['他人のカーソル', encodeActivityCursor(FIXED_ID, 'tweets', cursor)],
  ])('不正なカーソル（%s）ではヘッダーを残し、一覧を取得せず先頭へのリンクを出す', async (_l, value) => {
    await renderPage('Bob_12', { cursor: value });

    expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
    expect(query.requests.activity).toEqual([]);
    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/profile/Bob_12');
  });

  it('一覧の取得障害ではヘッダーと件数を残し、一覧部分に再試行を出す', async () => {
    vi.spyOn(query, 'findActivityPage').mockRejectedValue(new Error('db down: secret-host'));

    await renderPage('Bob_12');

    expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '5 フォロワー' })).toBeInTheDocument();
    expect(
      screen.getByText('一覧を取得できませんでした。時間をおいて再度お試しください'),
    ).toBeInTheDocument();
    expect(screen.queryByText('まだ投稿がありません')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret-host');
  });

  describe('公開いいねタブ', () => {
    const likeCursor = { createdAt: '2026-10-27T03:00:00.123456Z', likeId: '00000000-0000-4000-8000-0000000000e1' };

    it('未ログインでも、URLの綴りではなく解決した対象UUIDのいいね一覧を取得して表示する', async () => {
      query.likedPage = { items: [{ likeId: likeCursor.likeId, likedAt: likeCursor.createdAt, item }], nextCursor: null };

      await renderPage('BOB_12', { tab: 'likes' });

      expect(query.requests.liked).toEqual([{ subjectId: OTHER_ID, viewerId: null, after: null, limit: 20 }]);
      expect(query.requests.activity).toEqual([]);
      expect(query.requests.connections).toEqual([]);
      expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
      expect(screen.getByRole('article')).toHaveTextContent('ボブの投稿');
    });

    it('本人状態の判定にはログイン中の閲覧者を渡す（対象者と取り違えない）', async () => {
      signIn();

      await renderPage('Bob_12', { tab: 'likes' });

      expect(query.requests.liked).toEqual([{ subjectId: OTHER_ID, viewerId: FIXED_ID, after: null, limit: 20 }]);
    });

    it('0件ならヘッダーを残して空の案内を出す', async () => {
      await renderPage('Bob_12', { tab: 'likes' });

      expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
      expect(screen.getByText('いいねした投稿はまだありません')).toBeInTheDocument();
    });

    it('有効なカーソルを渡し、likesタブを保った「次の20件」「最新に戻る」を表示する', async () => {
      const next = { createdAt: '2026-10-27T03:00:00.000001Z', likeId: '00000000-0000-4000-8000-0000000000e2' };
      query.likedPage = { items: [{ likeId: likeCursor.likeId, likedAt: likeCursor.createdAt, item }], nextCursor: next };

      await renderPage('Bob_12', { tab: 'likes', cursor: encodeLikeCursor(OTHER_ID, likeCursor) });

      expect(query.requests.liked[0].after).toEqual(likeCursor);
      expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/profile/Bob_12?tab=likes');
      const nextHref = new URL(screen.getByRole('link', { name: '次の20件' }).getAttribute('href')!, 'http://x');
      expect(nextHref.searchParams.get('tab')).toBe('likes');
      expect(nextHref.searchParams.get('cursor')).toBe(encodeLikeCursor(OTHER_ID, next));
    });

    it.each([
      ['壊れた値', 'broken!!'],
      ['投稿タブのカーソル', encodeActivityCursor(OTHER_ID, 'tweets', cursor)],
      ['他人のいいねカーソル', encodeLikeCursor(FIXED_ID, likeCursor)],
    ])('不正なカーソル（%s）ではヘッダーを残し、一覧を取得せず先頭へのリンクを出す', async (_l, value) => {
      await renderPage('Bob_12', { tab: 'likes', cursor: value });

      expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
      expect(query.requests.liked).toEqual([]);
      expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/profile/Bob_12?tab=likes');
    });

    it('いいねカーソルを投稿タブへ持ち込んでも不正として扱う', async () => {
      await renderPage('Bob_12', { cursor: encodeLikeCursor(OTHER_ID, likeCursor) });

      expect(query.requests.activity).toEqual([]);
      expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/profile/Bob_12');
    });

    it('一覧の取得障害ではヘッダーを残し、0件にせず一覧部分に再試行を出す', async () => {
      vi.spyOn(query, 'findLikedPage').mockRejectedValue(new Error('db down: secret-host'));

      await renderPage('Bob_12', { tab: 'likes' });

      expect(screen.getByRole('heading', { name: 'ボブ' })).toBeInTheDocument();
      expect(screen.getByText('一覧を取得できませんでした。時間をおいて再度お試しください')).toBeInTheDocument();
      expect(screen.queryByText('いいねした投稿はまだありません')).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent('secret-host');
    });

    it('対象のプロフィールがなければ一覧を取得せず notFound にする', async () => {
      query.summary = null;

      await expect(page('Nobody_1', { tab: 'likes' })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
      expect(query.requests.liked).toEqual([]);
    });
  });

  it('ログイン中の利用者の確認に失敗したら、自分のリンクを出さず自分判定もしない', async () => {
    signIn();
    query.summary = { ...other, id: FIXED_ID, name: 'アリス', displayId: 'Alice_1' };
    vi.spyOn(accounts.users, 'findById').mockRejectedValue(new Error('db down'));

    await renderPage('Alice_1');

    expect(query.requests.summary[0]).toMatchObject({ viewerId: null });
    expect(screen.queryByText('自分のプロフィール')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'プロフィール' })).not.toBeInTheDocument();
  });
});
