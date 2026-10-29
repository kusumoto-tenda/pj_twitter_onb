import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { redirect } from 'next/navigation';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SetLikeActionResult } from '@/app/likes/actions';
import { LikeButton } from '@/app/ui/likes/like-button';
import { ActionFeedbackProvider } from '@/app/ui/notifications/action-feedback-provider';
import { ProfileLikesList } from '@/app/ui/profile/profile-likes-list';
import { ProfileTabs } from '@/app/ui/profile/profile-tabs';
import { TweetCard } from '@/app/ui/timeline/tweet-card';
import type { TimelineItem } from '@/application/dtos/timeline/timeline';

vi.mock('@/app/ui/tweets/tweet-actions-menu', () => ({ TweetActionsMenu: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const TWEET = '00000000-0000-4000-8000-0000000000d1';
const ME = '00000000-0000-4000-8000-0000000000a1';
const SUBJECT = '00000000-0000-4000-8000-0000000000b1';
const RETWEET = '00000000-0000-4000-8000-0000000000c1';

type Action = (formData: FormData) => Promise<SetLikeActionResult>;

function setup({
  active = false,
  count = 0,
  expectedActorId = ME as string | null,
  action = vi.fn<Action>().mockResolvedValue({ ok: true, active: !active, count: active ? count - 1 : count + 1 }),
} = {}) {
  render(
    <ActionFeedbackProvider>
      <LikeButton tweetId={TWEET} active={active} count={count} expectedActorId={expectedActorId} action={action} />
    </ActionFeedbackProvider>,
  );
  return { action, user: userEvent.setup() };
}

const button = () => screen.getByRole('button', { name: /^いいね(する|を取り消す)$/ });

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function thrownBy(run: () => never): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('制御例外が投げられませんでした');
}

class Boundary extends Component<{ children: ReactNode; onError: (error: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <p>境界で受け取りました</p> : this.props.children;
  }
}

function item(overrides: Partial<TimelineItem['tweet']> = {}, retweetedBy: TimelineItem['retweetedBy'] = null): TimelineItem {
  return {
    key: retweetedBy
      ? { eventAt: '2026-10-27T03:00:00.000000Z', kind: 'retweet', eventId: RETWEET }
      : { eventAt: '2026-10-26T03:00:00.000000Z', kind: 'tweet', eventId: TWEET },
    tweet: {
      id: TWEET,
      content: '元の投稿',
      author: { id: SUBJECT, name: 'ボブ', displayId: 'Bob_12' },
      createdAt: '2026-10-26T03:00:00.000000Z',
      images: [],
      favoritedByViewer: false,
      likedByViewer: false,
      likeCount: 0,
      retweetedByViewer: false,
      retweetCount: 0,
      ...overrides,
    },
    retweetedBy,
  };
}

describe('LikeButton', () => {
  it('未登録は輪郭のハートで「いいねする」（aria-pressed=false）、公開件数を表示する', () => {
    setup({ count: 3 });
    expect(button()).toHaveAccessibleName('いいねする');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(button().querySelector('svg')).toHaveAttribute('data-variant', 'outline');
    expect(screen.getByText('いいね3件', { exact: true })).toBeInTheDocument();
  });

  it('登録済みは塗りつぶしのハートで「いいねを取り消す」（aria-pressed=true）', () => {
    setup({ active: true, count: 1 });
    expect(button()).toHaveAccessibleName('いいねを取り消す');
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    expect(button().querySelector('svg')).toHaveAttribute('data-variant', 'solid');
    expect(screen.getByText('いいね1件', { exact: true })).toBeInTheDocument();
  });

  it.each([
    [false, 'true'],
    [true, 'false'],
  ])('active=%sなら、次の状態（%s）を明示して元投稿IDと画面の利用者と一緒に送る', async (active, next) => {
    const { action, user } = setup({ active, count: 1 });
    await user.click(button());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = action.mock.calls[0][0];
    expect([...data.keys()].sort()).toEqual(['active', 'expectedActorId', 'tweetId']);
    expect(data.get('tweetId')).toBe(TWEET);
    expect(data.get('active')).toBe(next);
    expect(data.get('expectedActorId')).toBe(ME);
  });

  it('処理中は押せず（連打しても1回だけ送る）、aria-busyで知らせる', async () => {
    const pending = deferred<SetLikeActionResult>();
    const { action, user } = setup({ action: vi.fn<Action>().mockReturnValue(pending.promise) });
    await user.click(button());
    await user.click(button());

    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute('aria-busy', 'true');
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true, active: true, count: 1 }));
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('Actionが失敗結果を返したら、状態・件数を変えずに理由を3秒通知する', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = setup({
        count: 2,
        action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'いいねを変更できませんでした。時間をおいて再度お試しください' }),
      });
      await user.click(button());

      expect(await screen.findByRole('alert')).toHaveTextContent('いいねを変更できませんでした。時間をおいて再度お試しください');
      expect(button()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('いいね2件', { exact: true })).toBeInTheDocument();
      expect(button()).toBeEnabled();
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Action自体がreject（通信の失敗など）しても画面を置き換えず、状態・件数を保ったまま通知し、同じ内容で再試行できる', async () => {
    const action = vi
      .fn<Action>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, active: true, count: 3 });
    const { user } = setup({ count: 2, action });
    await user.click(button());

    expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗しました。時間をおいて再度お試しください');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('いいね2件', { exact: true })).toBeInTheDocument();
    await waitFor(() => expect(button()).toBeEnabled());

    await user.click(button());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1][0].get('active')).toBe('true');
    expect(action.mock.calls[1][0].get('tweetId')).toBe(TWEET);
  });

  it('Next.jsの制御例外（redirect）は失敗として通知せず、同じ値のままNext.jsへ渡す', async () => {
    const control = thrownBy(() => redirect('/login'));
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ActionFeedbackProvider>
          <Boundary onError={onError}>
            <LikeButton tweetId={TWEET} active={false} count={0} expectedActorId={ME} action={vi.fn<Action>().mockRejectedValue(control)} />
          </Boundary>
        </ActionFeedbackProvider>,
      );
      await userEvent.setup().click(button());

      await waitFor(() => expect(onError).toHaveBeenCalledWith(control));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('未ログインで表示した画面では画面の利用者を送らず、返された案内だけを表示してその場に留まる', async () => {
    const { action, user } = setup({
      expectedActorId: null,
      action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'ログイン中のみいいねできます' }),
    });
    await user.click(button());

    expect(await screen.findByRole('alert')).toHaveTextContent('ログイン中のみいいねできます');
    expect(action.mock.calls[0][0].has('expectedActorId')).toBe(false);
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('成功時は通知を出さない（状態・件数は再取得したDBの値で表示する）', async () => {
    const { user } = setup();
    await user.click(button());
    await waitFor(() => expect(button()).toBeEnabled());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('サーバー描画の時点では無効で、操作できるようになってから有効にする', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(
      <ActionFeedbackProvider>
        <LikeButton tweetId={TWEET} active={false} count={0} expectedActorId={ME} action={vi.fn()} />
      </ActionFeedbackProvider>,
    );
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe('TweetCardのハート', () => {
  it('リツイートのカードでも元投稿のUUID・本人状態・件数を使い、いいね→お気に入りの順に並べる', () => {
    render(
      <ActionFeedbackProvider>
        <TweetCard
          item={item({ likedByViewer: true, likeCount: 5 }, { id: ME, name: 'アリス', displayId: 'Alice_1' })}
          viewerId={ME}
        />
      </ActionFeedbackProvider>,
    );
    const card = screen.getByRole('article');
    const like = within(card).getByRole('button', { name: 'いいねを取り消す' });
    expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByText('いいね5件', { exact: true })).toBeInTheDocument();
    const favorite = within(card).getByRole('button', { name: 'お気に入りに追加' });
    // いいねはお気に入りの旗より前（旗はカードの右端のまま）
    expect(like.compareDocumentPosition(favorite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ProfileLikesList', () => {
  it('空なら案内を出し、あれば元投稿のカードを閲覧者の本人状態で表示する（対象者の状態ではない）', () => {
    const { rerender } = render(
      <ActionFeedbackProvider>
        <ProfileLikesList items={[]} viewerId={null} />
      </ActionFeedbackProvider>,
    );
    expect(screen.getByText('いいねした投稿はまだありません')).toBeInTheDocument();

    // 対象者（一覧の持ち主）はいいね済みだが、閲覧者はまだいいねしていない
    rerender(
      <ActionFeedbackProvider>
        <ProfileLikesList
          viewerId={ME}
          items={[{ likeId: '00000000-0000-4000-8000-0000000000e1', likedAt: '2026-10-27T03:00:00.000000Z', item: item({ likeCount: 1 }) }]}
        />
      </ActionFeedbackProvider>,
    );
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('元の投稿');
    expect(within(card).getByRole('button', { name: 'いいねする' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(card).getByText('いいね1件', { exact: true })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'お気に入りに追加' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ProfileTabs', () => {
  it('ツイート・リツイート・いいねの3つを出し、いいねは?tab=likesで選択中を示す', () => {
    render(<ProfileTabs displayId="Bob_12" tab="likes" />);
    const nav = screen.getByRole('navigation', { name: 'プロフィールのタブ' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['ツイート', 'リツイート', 'いいね']);
    expect(within(nav).getByRole('link', { name: 'いいね' })).toHaveAttribute('href', '/profile/Bob_12?tab=likes');
    expect(within(nav).getByRole('link', { name: 'いいね' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'ツイート' })).not.toHaveAttribute('aria-current');
  });
});
