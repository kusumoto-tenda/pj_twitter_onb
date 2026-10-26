import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteEntry } from '@/application/favorites/favorite';
import { createAccount } from '@/application/users/create-account';
import { encodeFavoriteCursor } from '@/app/lib/favorite-query';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import { InMemoryFavoriteStore } from '@/test/support/in-memory-favorite-store';

const boundary = vi.hoisted(() => ({
  session: null as unknown,
  accountDeps: undefined as unknown,
  favoriteDeps: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/ui/tweets/tweet-actions-menu', () => ({
  TweetActionsMenu: ({ tweetId }: { tweetId: string }) => <span data-testid="tweet-menu">{tweetId}</span>,
}));
vi.mock('@/app/ui/favorites/favorite-button', () => ({
  FavoriteButton: ({ tweetId, active }: { tweetId: string; active: boolean }) => (
    <span data-testid="favorite-button" data-active={String(active)}>
      {tweetId}
    </span>
  ),
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
vi.mock('@/app/_composition/account', () => ({ getAccountDependencies: () => boundary.accountDeps }));
vi.mock('@/app/_composition/favorites', () => ({ getFavoriteDependencies: () => boundary.favoriteDeps }));

const { default: FavoritesPage, metadata } = await import('@/app/favorites/page');

const BOB = '00000000-0000-4000-8000-0000000000b0';
const TWEET = '00000000-0000-4000-8000-0000000000aa';
const FAV = '00000000-0000-4000-8000-0000000000f1';
const entry: FavoriteEntry = {
  favoriteId: FAV,
  favoritedAt: '2026-10-26T03:04:05.123456Z',
  item: {
    key: { eventAt: '2026-10-23T03:04:05.123456Z', kind: 'tweet', eventId: TWEET },
    tweet: {
      id: TWEET,
      content: 'ボブの投稿',
      author: { id: BOB, name: 'ボブ', displayId: 'Bob_12' },
      createdAt: '2026-10-23T03:04:05.123456Z',
      images: [],
      favoritedByViewer: true,
    },
    retweetedBy: null,
  },
};

let store: InMemoryFavoriteStore;

function signIn(id = FIXED_ID) {
  boundary.session = { user: { id }, expires: '2099-01-01T00:00:00Z' };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await FavoritesPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(async () => {
  const accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput);
  boundary.accountDeps = accounts.deps;
  store = new InMemoryFavoriteStore();
  boundary.favoriteDeps = { favorites: store, query: store, newId: () => FAV, now: () => new Date() };
  boundary.session = null;
});

describe('FavoritesPage', () => {
  it('ログイン中の本人の保存だけを、元投稿のカードと解除ボタン付きで表示する', async () => {
    signIn();
    store.page = { items: [entry], nextCursor: null };
    const findPage = vi.spyOn(store, 'findPage');

    await renderPage({ userId: BOB });

    expect(findPage).toHaveBeenCalledWith({ actorId: FIXED_ID, after: null, limit: 20 });
    expect(screen.getByRole('heading', { name: 'お気に入り', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('ボブの投稿');
    expect(screen.getByRole('link', { name: 'お気に入り' })).toHaveAttribute('aria-current', 'page');
    expect(metadata).toMatchObject({ title: 'お気に入り' });
  });

  it('未ログインならログイン画面へ移動し、Queryを呼ばない', async () => {
    const findPage = vi.spyOn(store, 'findPage');

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(findPage).not.toHaveBeenCalled();
  });

  it('次ページがあれば本人に結び付いたカーソルのリンクを出し、カーソル指定中は先頭へのリンクも出す', async () => {
    signIn();
    const next = { createdAt: '2026-10-26T03:00:00.000001Z', favoriteId: FAV };
    store.page = { items: [entry], nextCursor: next };
    const cursor = encodeFavoriteCursor(FIXED_ID, next);

    await renderPage({ cursor });

    expect(screen.getByRole('link', { name: '次の20件' })).toHaveAttribute('href', `/favorites?cursor=${cursor}`);
    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/favorites');
  });

  it('空の一覧と、空になったページ（カーソル指定中）を区別して先頭へのリンクを出す', async () => {
    signIn();
    await renderPage();
    expect(screen.getByText('お気に入りはまだありません')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '最新に戻る' })).not.toBeInTheDocument();
 
    cleanup();
    await renderPage({ cursor: encodeFavoriteCursor(FIXED_ID, { createdAt: '2026-10-26T03:00:00.000001Z', favoriteId: FAV }) });
    expect(screen.getByText('お気に入りはまだありません')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/favorites');
  });

  it('他人のカーソル・壊れたカーソルは不正として表示し、Queryを呼ばない', async () => {
    signIn();
    const findPage = vi.spyOn(store, 'findPage');

    await renderPage({ cursor: encodeFavoriteCursor(BOB, { createdAt: '2026-10-26T03:00:00.000001Z', favoriteId: FAV }) });

    expect(screen.getByText('表示する位置を読み込めませんでした')).toBeInTheDocument();
    expect(findPage).not.toHaveBeenCalled();
  });

  it('取得障害・利用者確認の障害は0件と区別して再試行を表示する', async () => {
    signIn();
    vi.spyOn(store, 'findPage').mockRejectedValueOnce(new Error('db down: secret-host'));
    await renderPage();
    expect(screen.getByText('お気に入りを取得できませんでした。時間をおいて再度お試しください')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-host');
  });
});
