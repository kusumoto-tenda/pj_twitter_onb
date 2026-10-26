import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileSummary } from '@/application/profile/profile';
import type { TimelineItem } from '@/application/timeline/timeline';
import { ProfileActivityList } from '@/app/ui/profile/profile-activity-list';
import { ProfileConnectionsList } from '@/app/ui/profile/profile-connections-list';
import { ProfileHeader, formatJoinedDate } from '@/app/ui/profile/profile-header';
import { ProfileRetry } from '@/app/ui/profile/profile-retry';
import { ProfileTabs } from '@/app/ui/profile/profile-tabs';

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
// リツイートボタン（ルートlayoutのProviderが必要）は、渡された値が分かる目印にする。
vi.mock('@/app/ui/retweets/retweet-button', () => ({
  RetweetButton: ({ tweetId, active, count }: { tweetId: string; active: boolean; count: number }) => (
    <span data-testid="retweet-button" data-tweet={tweetId} data-active={String(active)} data-count={count} />
  ),
}));

// フォローボタン（ルートlayoutのProviderが必要）は、渡された値が分かる目印にする。
vi.mock('@/app/ui/profile/follow-button', () => ({
  FollowButton: ({ targetId, active, expectedActorId }: { targetId: string; active: boolean; expectedActorId: string | null }) => (
    <span data-testid="follow-button" data-target={targetId} data-active={String(active)} data-actor={expectedActorId ?? ''} />
  ),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const transition = vi.hoisted(() => ({ forcePending: false }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useTransition: () =>
      transition.forcePending
        ? ([true, (callback: () => void) => callback()] as const)
        : actual.useTransition(),
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const profile: ProfileSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'アリス',
  displayId: 'Alice_1',
  bio: 'よろしく\n<b>二行目</b>',
  createdAt: '2026-10-23T15:30:00.123456Z',
  followingCount: 2,
  followerCount: 3,
  followedByViewer: false,
};

const VIEWER = '00000000-0000-4000-8000-0000000000f1';

beforeEach(() => {
  router.refresh.mockReset();
});

describe('formatJoinedDate', () => {
  it('Asia/Tokyoの YYYY年MM月DD日から利用しています で表示する', () => {
    expect(formatJoinedDate('2026-10-23T15:30:00.123456Z')).toBe('2026年10月24日から利用しています');
  });
});

describe('ProfileHeader', () => {
  it('名前・ID・bio・利用開始日・件数を表示し、件数を一覧へのリンクにする', () => {
    render(<ProfileHeader profile={profile} isSelf={false} viewerId={VIEWER} tab="tweets" />);

    const header = screen.getByRole('region', { name: 'プロフィール' });
    expect(screen.getByRole('heading', { name: 'アリス' })).toBeInTheDocument();
    expect(header).toHaveTextContent('@Alice_1');
    expect(header).toHaveTextContent('2026年10月24日から利用しています');
    expect(screen.getByRole('link', { name: '2 フォロー' })).toHaveAttribute(
      'href',
      '/profile/Alice_1?tab=following',
    );
    expect(screen.getByRole('link', { name: '3 フォロワー' })).toHaveAttribute(
      'href',
      '/profile/Alice_1?tab=followers',
    );
  });

  it('bioの改行を保ち、HTML風の文字列をDOMとして解釈しない', () => {
    render(<ProfileHeader profile={profile} isSelf={false} viewerId={VIEWER} tab="tweets" />);

    const bio = screen.getByText(/よろしく/);
    expect(bio.textContent).toBe('よろしく\n<b>二行目</b>');
    expect(bio.querySelector('b')).toBeNull();
  });

  it('bioが空なら段落を出さない', () => {
    render(<ProfileHeader profile={{ ...profile, bio: '' }} isSelf={false} viewerId={VIEWER} tab="tweets" />);

    expect(screen.getByRole('region', { name: 'プロフィール' }).querySelector('[data-bio]')).toBeNull();
  });

  it('自分なら「自分のプロフィール」と編集リンクを表示し、操作ボタンは出さない', () => {
    render(<ProfileHeader profile={{ ...profile, followedByViewer: false }} isSelf viewerId={profile.id} tab="tweets" />);

    expect(screen.getByText('自分のプロフィール')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'プロフィール編集' })).toHaveAttribute(
      'href',
      '/profile/Alice_1/edit',
    );
    expect(screen.getByRole('link', { name: 'アカウント削除' })).toHaveAttribute(
      'href',
      '/profile/Alice_1/delete',
    );
    expect(screen.queryByTestId('follow-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('フォロー済みの他人なら、対象のUUID・状態・閲覧者をフォローボタンへ渡す', () => {
    render(<ProfileHeader profile={{ ...profile, followedByViewer: true }} isSelf={false} viewerId={VIEWER} tab="tweets" />);

    const follow = screen.getByTestId('follow-button');
    expect(follow).toHaveAttribute('data-target', profile.id);
    expect(follow).toHaveAttribute('data-active', 'true');
    expect(follow).toHaveAttribute('data-actor', VIEWER);
    expect(screen.queryByText('自分のプロフィール')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'プロフィール編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'アカウント削除' })).not.toBeInTheDocument();
  });

  it('未ログインで見た他人では、閲覧者なしの未フォローのボタンを出し、自分向けの表示は出さない', () => {
    render(<ProfileHeader profile={profile} isSelf={false} viewerId={null} tab="tweets" />);

    const follow = screen.getByTestId('follow-button');
    expect(follow).toHaveAttribute('data-target', profile.id);
    expect(follow).toHaveAttribute('data-active', 'false');
    expect(follow).toHaveAttribute('data-actor', '');
    expect(screen.queryByText('自分のプロフィール')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'プロフィール編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'アカウント削除' })).not.toBeInTheDocument();
  });

  it('フォロー・フォロワーのタブでは対応する件数リンクを選択状態にする', () => {
    const { rerender } = render(<ProfileHeader profile={profile} isSelf={false} viewerId={VIEWER} tab="followers" />);
    expect(screen.getByRole('link', { name: '3 フォロワー' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '2 フォロー' })).not.toHaveAttribute('aria-current');

    rerender(<ProfileHeader profile={profile} isSelf={false} viewerId={VIEWER} tab="following" />);
    expect(screen.getByRole('link', { name: '2 フォロー' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '3 フォロワー' })).not.toHaveAttribute('aria-current');
  });
});

describe('ProfileTabs', () => {
  it('ツイート・リツイートのリンクを表示し、URLのタブを選択状態にする', () => {
    const { rerender } = render(<ProfileTabs displayId="Alice_1" tab="tweets" />);
    const nav = screen.getByRole('navigation', { name: 'プロフィールのタブ' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ツイート' })).toHaveAttribute('href', '/profile/Alice_1');
    expect(screen.getByRole('link', { name: 'ツイート' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'リツイート' })).toHaveAttribute(
      'href',
      '/profile/Alice_1?tab=retweets',
    );

    rerender(<ProfileTabs displayId="Alice_1" tab="followers" />);
    expect(screen.getByRole('link', { name: 'ツイート' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'リツイート' })).not.toHaveAttribute('aria-current');
  });
});

describe('ProfileActivityList', () => {
  const item: TimelineItem = {
    key: {
      eventAt: '2026-10-23T03:04:05.123456Z',
      kind: 'tweet',
      eventId: '00000000-0000-4000-8000-0000000000aa',
    },
    tweet: {
      id: '00000000-0000-4000-8000-0000000000aa',
      content: 'プロフィールの投稿',
      author: { id: profile.id, name: 'アリス', displayId: 'Alice_1' },
      createdAt: '2026-10-23T03:04:05.123456Z',
      images: [],
      favoritedByViewer: false,
      likedByViewer: false,
      likeCount: 0,
      retweetedByViewer: false,
      retweetCount: 0,
    },
    retweetedBy: null,
  };

  it('既存の投稿カードで表示する', () => {
    render(<ProfileActivityList items={[item]} tab="tweets" />);

    expect(screen.getByRole('article')).toHaveTextContent('プロフィールの投稿');
  });

  it('投稿0件とリツイート0件で別の空表示を出す', () => {
    const { rerender } = render(<ProfileActivityList items={[]} tab="tweets" />);
    expect(screen.getByText('まだ投稿がありません')).toBeInTheDocument();

    rerender(<ProfileActivityList items={[]} tab="retweets" />);
    expect(screen.getByText('まだリツイートがありません')).toBeInTheDocument();
  });
});

describe('ProfileConnectionsList', () => {
  const bob = { id: '00000000-0000-4000-8000-000000000002', name: 'ボブ', displayId: 'Bob_12' };

  it('名前・IDとプロフィールへのリンクを表示する', () => {
    render(<ProfileConnectionsList people={[bob]} direction="followers" />);

    const list = screen.getByRole('list', { name: 'フォロワー' });
    expect(list).toHaveTextContent('@Bob_12');
    expect(screen.getByRole('link', { name: /ボブ/ })).toHaveAttribute('href', '/profile/Bob_12');
  });

  it('フォロー一覧のリストはフォロー中のユーザーとして示す', () => {
    render(<ProfileConnectionsList people={[bob]} direction="following" />);

    expect(screen.getByRole('list', { name: 'フォロー中のユーザー' })).toBeInTheDocument();
  });

  it('フォロー0人とフォロワー0人で別の空表示を出す', () => {
    const { rerender } = render(<ProfileConnectionsList people={[]} direction="following" />);
    expect(screen.getByText('まだ誰もフォローしていません')).toBeInTheDocument();

    rerender(<ProfileConnectionsList people={[]} direction="followers" />);
    expect(screen.getByText('まだフォロワーはいません')).toBeInTheDocument();
  });
});

describe('ProfileRetry', () => {
  it('プロフィール全体と一覧部分で別のメッセージを出し、router.refreshで再取得する', async () => {
    const { rerender } = render(<ProfileRetry scope="profile" />);
    expect(screen.getByText('プロフィールを取得できませんでした')).toBeInTheDocument();

    rerender(<ProfileRetry scope="list" />);
    expect(
      screen.getByText('一覧を取得できませんでした。時間をおいて再度お試しください'),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '再試行' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('再取得中はボタンを無効にして二重実行しない', async () => {
    transition.forcePending = true;
    try {
      render(<ProfileRetry scope="list" />);
      const button = screen.getByRole('button', { name: /再試行/ });

      expect(button).toBeDisabled();
      await userEvent.setup().click(button);
      expect(router.refresh).not.toHaveBeenCalled();
    } finally {
      transition.forcePending = false;
    }
  });
});
