import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineCursor, TimelinePage } from '@/application/timeline/timeline';
import { createAccount } from '@/application/users/create-account';
import { encodeCursor } from '@/app/lib/timeline-query';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { InMemoryTimelineQuery } from '@/test/support/in-memory-timeline-query';

const boundary = vi.hoisted(() => ({
  session: null as unknown,
  accountDeps: undefined as unknown,
  timelineDeps: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
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
vi.mock('@/app/_composition/timeline', () => ({
  getTimelineDependencies: () => boundary.timelineDeps,
}));

const { default: HomePage } = await import('@/app/(home)/page');

const cursor: TimelineCursor = {
  eventAt: '2026-10-23T03:04:05.123456Z',
  kind: 'tweet',
  eventId: '00000000-0000-4000-8000-0000000000aa',
};
const page: TimelinePage = {
  items: [
    {
      key: cursor,
      tweet: {
        id: cursor.eventId,
        content: 'タイムラインの投稿',
        author: { id: FIXED_ID, name: 'アリス', displayId: 'Alice_1' },
        createdAt: cursor.eventAt,
        images: [],
        favoritedByViewer: false,
        likedByViewer: false,
        likeCount: 0,
        retweetedByViewer: false,
        retweetCount: 0,
      },
      retweetedBy: null,
    },
  ],
  nextCursor: null,
};

let accounts: ReturnType<typeof createTestDependencies>;
let query: InMemoryTimelineQuery;

function signIn(id = FIXED_ID) {
  boundary.session = { user: { id }, expires: '2099-01-01T00:00:00Z' };
}

async function renderHome(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await HomePage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(async () => {
  accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput);
  query = new InMemoryTimelineQuery(page);
  boundary.accountDeps = accounts.deps;
  boundary.timelineDeps = { query };
  boundary.session = null;
});

describe('HomePage', () => {
  it('未ログインでは全体一覧とログイン・登録への導線を表示する', async () => {
    await renderHome();

    expect(query.requests).toEqual([{ viewerId: null, followingOnly: false, after: null, limit: 20 }]);
    expect(screen.getByRole('heading', { name: '最新ツイート' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('タイムラインの投稿');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ログイン中のユーザー')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'アカウントを作成' })).toHaveAttribute('href', '/signin');
    expect(screen.getByRole('link', { name: 'ホーム' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'プロフィール' })).not.toBeInTheDocument();
  });

  it('閲覧者本人の投稿にだけ三点メニューを出す', async () => {
    await renderHome();
    expect(screen.queryByTestId('tweet-menu')).not.toBeInTheDocument();

    signIn();
    await renderHome();
    expect(screen.getByTestId('tweet-menu')).toHaveTextContent(page.items[0].tweet.id);
  });

  it('ログイン中は利用者の名前・IDと未チェックの切り替えを表示し、viewerIdで取得する', async () => {
    signIn();

    await renderHome();

    expect(query.requests[0]).toMatchObject({ viewerId: FIXED_ID, followingOnly: false });
    expect(screen.getByLabelText('ログイン中のユーザー')).toHaveTextContent('アリス');
    expect(screen.getByLabelText('ログイン中のユーザー')).toHaveTextContent('@Alice_1');
    expect(screen.getByRole('checkbox', { name: 'フォローのみ' })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'プロフィール' })).toHaveAttribute('href', '/profile/Alice_1');
  });

  it('ログイン中に follow=true ならフォロー一覧を取得し、切り替えをチェック済みにする', async () => {
    signIn();

    await renderHome({ follow: 'true' });

    expect(query.requests[0]).toMatchObject({ viewerId: FIXED_ID, followingOnly: true });
    expect(screen.getByRole('checkbox', { name: 'フォローのみ' })).toBeChecked();
  });

  it.each([
    ['false', 'false'],
    ['重複パラメータ', ['true', 'true']],
  ])('follow=%sは全体一覧にする', async (_label, follow) => {
    signIn();

    await renderHome({ follow });

    expect(query.requests[0]).toMatchObject({ followingOnly: false });
  });

  it('未ログインで follow=true なら一覧を取得せず /login へredirectする', async () => {
    await expect(
      HomePage({ searchParams: Promise.resolve({ follow: 'true' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(query.requests).toEqual([]);
  });

  it('セッションだけ残り利用者がDBにいない場合は未ログインとして扱う', async () => {
    signIn('00000000-0000-4000-8000-00000000dead');

    await renderHome();
    expect(query.requests[0]).toMatchObject({ viewerId: null });
    expect(screen.queryByLabelText('ログイン中のユーザー')).not.toBeInTheDocument();

    await expect(
      HomePage({ searchParams: Promise.resolve({ follow: 'true' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('利用者の確認でDB障害が起きたら取得失敗を表示し、詳細を出さない', async () => {
    signIn();
    vi.spyOn(accounts.users, 'findById').mockRejectedValue(new Error('db down: secret-host'));

    await renderHome();

    expect(
      screen.getByText('投稿を取得できませんでした。時間をおいて再度お試しください'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret-host');
    expect(query.requests).toEqual([]);
  });

  it('不正なカーソルでは一覧を取得せず、絞り込みを保った最新へのリンクを表示する', async () => {
    signIn();

    await renderHome({ follow: 'true', cursor: 'broken!!' });

    expect(query.requests).toEqual([]);
    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/?follow=true');
    expect(screen.queryByText('自分とフォロー中のユーザーの投稿はまだありません')).not.toBeInTheDocument();
  });

  it('有効なカーソルを渡し、「最新に戻る」と条件を保った「次の20件」を表示する', async () => {
    signIn();
    const next: TimelineCursor = { ...cursor, eventId: '00000000-0000-4000-8000-0000000000bb' };
    query.setPage({ ...page, nextCursor: next });

    await renderHome({ follow: 'true', cursor: encodeCursor(cursor) });

    expect(query.requests[0]).toMatchObject({ after: cursor, followingOnly: true });
    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/?follow=true');
    const nextHref = new URL(
      screen.getByRole('link', { name: '次の20件' }).getAttribute('href')!,
      'http://localhost',
    );
    expect(nextHref.searchParams.get('follow')).toBe('true');
    expect(nextHref.searchParams.get('cursor')).toBe(encodeCursor(next));
  });

  it('一覧の取得失敗は空表示にせず、再試行の導線を表示する', async () => {
    vi.spyOn(query, 'findPage').mockRejectedValue(new Error('SELECT failed at secret-host'));

    await renderHome();

    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
    expect(screen.queryByText('まだ投稿がありません')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret-host');
  });

  it('空の一覧では空のメッセージを表示する', async () => {
    query.setPage({ items: [], nextCursor: null });

    await renderHome();

    expect(screen.getByText('まだ投稿がありません')).toBeInTheDocument();
  });

  it('登録直後の成功通知を表示する', async () => {
    signIn();
    document.cookie = 'flash=account-created; path=/';

    await renderHome();

    expect(await screen.findByRole('status')).toHaveTextContent('アカウントを作成しました');
  });
});
