import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/application/timeline/timeline';
import { MainNavigation } from '@/app/ui/timeline/main-navigation';
import { TimelineFilter } from '@/app/ui/timeline/timeline-filter';
import { InvalidCursorNotice, TimelineList } from '@/app/ui/timeline/timeline-list';
import { TimelinePagination } from '@/app/ui/timeline/timeline-pagination';
import { TimelineRetry } from '@/app/ui/timeline/timeline-retry';
import { TweetCard, formatTimelineDate } from '@/app/ui/timeline/tweet-card';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const transition = vi.hoisted(() => ({ forcePending: false }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// 再取得中の表示を確かめるため、必要なテストだけ useTransition を処理中に固定する。
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
// 三点メニューの中身はメニューのテストで確認する。ここでは表示の有無だけを見る。
vi.mock('@/app/ui/tweets/tweet-actions-menu', () => ({
  TweetActionsMenu: ({ tweetId, menuKey }: { tweetId: string; menuKey: string }) => (
    <button type="button" data-tweet-id={tweetId} data-menu-key={menuKey}>
      ツイートの操作
    </button>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const alice = { id: '00000000-0000-4000-8000-000000000001', name: 'アリス', displayId: 'Alice_1' };
const bob = { id: '00000000-0000-4000-8000-000000000002', name: 'ボブ', displayId: 'Bob_12' };

function item(overrides: Partial<TimelineItem> = {}, content = 'こんにちは'): TimelineItem {
  return {
    key: {
      eventAt: '2026-10-23T03:04:05.123456Z',
      kind: 'tweet',
      eventId: '00000000-0000-4000-8000-0000000000aa',
    },
    tweet: {
      id: '00000000-0000-4000-8000-0000000000aa',
      content,
      author: alice,
      createdAt: '2026-10-23T03:04:05.123456Z',
      images: [],
    },
    retweetedBy: null,
    ...overrides,
  };
}

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

describe('formatTimelineDate', () => {
  it('Asia/Tokyoの YYYY/MM/DD HH:mm で表示する', () => {
    expect(formatTimelineDate('2026-10-23T15:04:05.123456Z')).toBe('2026/10/24 00:04');
  });
});

describe('TweetCard', () => {
  it('通常投稿の名前・ID・本文・日時を表示する', () => {
    render(<TweetCard item={item()} />);

    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('アリス');
    expect(card).toHaveTextContent('@Alice_1');
    expect(card).toHaveTextContent('こんにちは');
    const time = card.querySelector('time')!;
    expect(time).toHaveAttribute('dateTime', '2026-10-23T03:04:05.123456Z');
    expect(time).toHaveTextContent('2026/10/23 12:04');
    expect(card).not.toHaveTextContent('リツイート');
  });

  it('元投稿者が閲覧者本人のカードにだけ「ツイートの操作」を出す（リツイートでも元投稿者で判断する）', () => {
    const retweet = item({
      key: { ...item().key, kind: 'retweet', eventId: '00000000-0000-4000-8000-0000000000bb' },
      retweetedBy: bob,
    });
    const { rerender } = render(<TweetCard item={item()} viewerId={alice.id} />);
    expect(screen.getByRole('button', { name: 'ツイートの操作' })).toHaveAttribute('data-tweet-id', item().tweet.id);
    expect(screen.getByRole('button', { name: 'ツイートの操作' })).toHaveAttribute('data-menu-key', `tweet:${item().key.eventId}`);

    // 他人がリツイートした自分の投稿
    rerender(<TweetCard item={retweet} viewerId={alice.id} />);
    expect(screen.getByRole('button', { name: 'ツイートの操作' })).toBeInTheDocument();
    // 自分（ボブ）がリツイートした他人の投稿
    rerender(<TweetCard item={retweet} viewerId={bob.id} />);
    expect(screen.queryByRole('button', { name: 'ツイートの操作' })).not.toBeInTheDocument();
    // 未ログイン
    rerender(<TweetCard item={item()} viewerId={null} />);
    expect(screen.queryByRole('button', { name: 'ツイートの操作' })).not.toBeInTheDocument();
  });

  it('投稿者名を保存済みのIDのプロフィールへのリンクにする', () => {
    render(<TweetCard item={item()} />);

    expect(screen.getByRole('link', { name: 'アリス' })).toHaveAttribute('href', '/profile/Alice_1');
  });

  it('リツイート実行者と元投稿者をそれぞれのプロフィールへのリンクにする', () => {
    render(
      <TweetCard
        item={item({
          key: { ...item().key, kind: 'retweet', eventId: '00000000-0000-4000-8000-0000000000bb' },
          retweetedBy: bob,
        })}
      />,
    );

    expect(screen.getByRole('link', { name: 'ボブ' })).toHaveAttribute('href', '/profile/Bob_12');
    expect(screen.getByRole('link', { name: 'アリス' })).toHaveAttribute('href', '/profile/Alice_1');
  });

  it('リツイートでは実行者と元投稿者・本文を表示する', () => {
    render(
      <TweetCard
        item={item({
          key: { ...item().key, kind: 'retweet', eventId: '00000000-0000-4000-8000-0000000000bb' },
          retweetedBy: bob,
        })}
      />,
    );

    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('ボブさんがリツイート');
    expect(card).toHaveTextContent('アリス');
    expect(card).toHaveTextContent('@Alice_1');
    expect(card).toHaveTextContent('こんにちは');
  });

  it('添付画像を表示順に、/media のURL・寸法・代替テキスト・遅延読み込み付きで表示する', () => {
    const images = [
      { id: '00000000-0000-4000-8000-0000000000c2', position: 1, width: 20, height: 10 },
      { id: '00000000-0000-4000-8000-0000000000c1', position: 0, width: 40, height: 30 },
    ];
    render(<TweetCard item={item({ tweet: { ...item().tweet, images } })} />);

    const imgs = screen.getAllByRole('img');
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual([
      '/media/00000000-0000-4000-8000-0000000000c1',
      '/media/00000000-0000-4000-8000-0000000000c2',
    ]);
    expect(imgs[0]).toHaveAttribute('alt', '添付画像1');
    expect(imgs[0]).toHaveAttribute('width', '40');
    expect(imgs[0]).toHaveAttribute('height', '30');
    expect(imgs[0]).toHaveAttribute('loading', 'lazy');
  });

  it('画像だけの投稿では空の本文段落を出さない', () => {
    const images = [{ id: '00000000-0000-4000-8000-0000000000c1', position: 0, width: 4, height: 3 }];
    render(<TweetCard item={item({ tweet: { ...item().tweet, content: '', images } })} />);

    expect(screen.getByRole('article').querySelector('p[data-content]')).toBeNull();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('リツイートでも元投稿の画像を表示する', () => {
    const images = [{ id: '00000000-0000-4000-8000-0000000000c1', position: 0, width: 4, height: 3 }];
    render(
      <TweetCard
        item={item({
          key: { ...item().key, kind: 'retweet', eventId: '00000000-0000-4000-8000-0000000000bb' },
          tweet: { ...item().tweet, images },
          retweetedBy: bob,
        })}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/00000000-0000-4000-8000-0000000000c1');
  });

  it('本文の改行を保持し、HTML風の文字列をDOMとして解釈しない', () => {
    const content = '1行目\n<img src=x onerror="alert(1)"><b>太字</b>';
    render(<TweetCard item={item({}, content)} />);

    const card = screen.getByRole('article');
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(screen.getByText(/<img src=x/).textContent).toBe(content);
  });
});

describe('TimelineList', () => {
  it('出来事ごとにカードを表示する', () => {
    const retweet = item({
      key: { ...item().key, kind: 'retweet', eventId: '00000000-0000-4000-8000-0000000000bb' },
      retweetedBy: bob,
    });
    render(<TimelineList items={[retweet, item()]} followingOnly={false} />);

    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('空の全体一覧とフォロー一覧で別のメッセージを表示する', () => {
    const { rerender } = render(<TimelineList items={[]} followingOnly={false} />);
    expect(screen.getByText('まだ投稿がありません')).toBeInTheDocument();

    rerender(<TimelineList items={[]} followingOnly />);
    expect(screen.getByText('自分とフォロー中のユーザーの投稿はまだありません')).toBeInTheDocument();
  });

  it('不正なカーソルでは条件を保った最新へのリンクを表示する', () => {
    render(<InvalidCursorNotice latestHref="/?follow=true" />);

    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/?follow=true');
  });
});

describe('TimelineFilter', () => {
  it('ログイン中はラベル付きcheckboxで表示し、操作するとURLを遷移する', async () => {
    render(<TimelineFilter loggedIn followingOnly={false} toggleHref="/?follow=true" />);

    const checkbox = screen.getByRole('checkbox', { name: 'フォローのみ' });
    expect(checkbox).not.toBeChecked();
    await userEvent.setup().click(checkbox);

    expect(router.push).toHaveBeenCalledWith('/?follow=true');
  });

  it('遷移の完了を待たず、操作した時点でチェック状態を切り替えて表示する', async () => {
    // 遷移が終わらない状態を再現する。
    router.push.mockImplementation(() => new Promise(() => {}));
    render(<TimelineFilter loggedIn followingOnly={false} toggleHref="/?follow=true" />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'フォローのみ' }));

    expect(screen.getByRole('checkbox', { name: 'フォローのみ' })).toBeChecked();
  });

  it('遷移後に再読み込みせず戻ると、戻り先のURL条件どおりにチェックを外す', async () => {
    const { rerender } = render(
      <TimelineFilter loggedIn followingOnly={false} toggleHref="/?follow=true" />,
    );
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'フォローのみ' }));

    // 遷移完了（/?follow=true）
    rerender(<TimelineFilter loggedIn followingOnly toggleHref="/" />);
    expect(screen.getByRole('checkbox', { name: 'フォローのみ' })).toBeChecked();

    // ブラウザの「戻る」（/）
    rerender(<TimelineFilter loggedIn followingOnly={false} toggleHref="/?follow=true" />);
    expect(screen.getByRole('checkbox', { name: 'フォローのみ' })).not.toBeChecked();
  });

  it('フォロー一覧ではチェック済みで表示する', () => {
    render(<TimelineFilter loggedIn followingOnly toggleHref="/" />);

    expect(screen.getByRole('checkbox', { name: 'フォローのみ' })).toBeChecked();
  });

  it('未ログインでは切り替えの代わりにログインへのリンクを表示する', () => {
    render(<TimelineFilter loggedIn={false} followingOnly={false} toggleHref="/?follow=true" />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ログイン/ })).toHaveAttribute('href', '/login');
  });
});

describe('TimelinePagination', () => {
  it('次ページがあるときだけ「次の20件」を、カーソル指定時だけ「最新に戻る」を表示する', () => {
    const { rerender } = render(<TimelinePagination nextHref={null} latestHref={null} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(<TimelinePagination nextHref="/?follow=true&cursor=abc" latestHref="/?follow=true" />);
    expect(screen.getByRole('link', { name: '次の20件' })).toHaveAttribute(
      'href',
      '/?follow=true&cursor=abc',
    );
    expect(screen.getByRole('link', { name: '最新に戻る' })).toHaveAttribute('href', '/?follow=true');
  });
});

describe('TimelineRetry', () => {
  it('取得失敗のメッセージと再試行ボタンを表示し、router.refreshで再取得する', async () => {
    render(<TimelineRetry />);

    expect(
      screen.getByText('投稿を取得できませんでした。時間をおいて再度お試しください'),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '再試行' }));

    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('再取得中はボタンを無効にして二重実行しない', async () => {
    transition.forcePending = true;
    try {
      render(<TimelineRetry />);
      const button = screen.getByRole('button', { name: /再試行/ });

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      await userEvent.setup().click(button);
      expect(router.refresh).not.toHaveBeenCalled();
    } finally {
      transition.forcePending = false;
    }
  });
});

describe('MainNavigation', () => {
  it('ホームを開いているときはホームを現在のページにする', () => {
    render(<MainNavigation activePage="home" profileHref="/profile/Alice_1" />);

    expect(screen.getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'プロフィール' })).toHaveAttribute('href', '/profile/Alice_1');
    expect(screen.getByRole('link', { name: 'プロフィール' })).not.toHaveAttribute('aria-current');
  });

  it('自分のプロフィールを開いているときはプロフィールを現在のページにする', () => {
    render(<MainNavigation activePage="profile" profileHref="/profile/Alice_1" />);

    expect(screen.getByRole('link', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'プロフィール' })).toHaveAttribute('aria-current', 'page');
  });

  it('未ログインでは自分のプロフィールへのリンクを出さない', () => {
    render(<MainNavigation activePage={null} profileHref={null} />);

    expect(screen.getByRole('link', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: 'プロフィール' })).not.toBeInTheDocument();
  });
});

describe('MainNavigation（操作の配置）', () => {
  it('末尾に投稿ボタンなどの操作を置ける', () => {
    render(
      <MainNavigation activePage="home" profileHref={null}>
        <button type="button">ツイートする</button>
      </MainNavigation>,
    );

    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toContainElement(
      screen.getByRole('button', { name: 'ツイートする' }),
    );
  });
});
