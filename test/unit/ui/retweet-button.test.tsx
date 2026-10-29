import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { redirect } from 'next/navigation';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SetRetweetActionResult } from '@/app/retweets/actions';
import { ActionFeedbackProvider } from '@/app/ui/notifications/action-feedback-provider';
import { RetweetButton } from '@/app/ui/retweets/retweet-button';
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
// カードの送信先を差し替えて、どの値を送ったかを確かめる。
const cardAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/retweets/actions', () => ({ setRetweetAction: cardAction }));

const TWEET = '00000000-0000-4000-8000-0000000000d1';
const ME = '00000000-0000-4000-8000-0000000000a1';
const SUBJECT = '00000000-0000-4000-8000-0000000000b1';
const RETWEET = '00000000-0000-4000-8000-0000000000c1';
const RETWEETER = '00000000-0000-4000-8000-0000000000c2';

type Action = (formData: FormData) => Promise<SetRetweetActionResult>;

function setup({
  active = false,
  count = 0,
  expectedActorId = ME as string | null,
  action = vi.fn<Action>().mockResolvedValue({ ok: true, active: !active, count: active ? count - 1 : count + 1 }),
} = {}) {
  render(
    <ActionFeedbackProvider>
      <RetweetButton tweetId={TWEET} active={active} count={count} expectedActorId={expectedActorId} action={action} />
    </ActionFeedbackProvider>,
  );
  return { action, user: userEvent.setup() };
}

const button = () => screen.getByRole('button', { name: /^リツイート(する|を解除)$/ });

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

describe('RetweetButton', () => {
  it('未実行は「リツイートする」（aria-pressed=false）、公開件数を表示する', () => {
    setup({ count: 3 });
    expect(button()).toHaveAccessibleName('リツイートする');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('リツイート3件', { exact: true })).toBeInTheDocument();
  });

  it('実行済みは「リツイートを解除」（aria-pressed=true）', () => {
    setup({ active: true, count: 1 });
    expect(button()).toHaveAccessibleName('リツイートを解除');
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('リツイート1件', { exact: true })).toBeInTheDocument();
  });

  it.each([
    [false, 'true'],
    [true, 'false'],
  ])('active=%sなら、次の状態（%s）を明示して元投稿IDと画面の利用者だけを送る', async (active, next) => {
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
    const pending = deferred<SetRetweetActionResult>();
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
        action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'リツイートを変更できませんでした。時間をおいて再度お試しください' }),
      });
      await user.click(button());

      expect(await screen.findByRole('alert')).toHaveTextContent('リツイートを変更できませんでした。時間をおいて再度お試しください');
      expect(button()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('リツイート2件', { exact: true })).toBeInTheDocument();
      expect(button()).toBeEnabled();
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Action自体がreject（通信の失敗など）しても状態・件数を保ったまま通知し、同じ内容で再試行できる', async () => {
    const action = vi
      .fn<Action>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, active: true, count: 3 });
    const { user } = setup({ count: 2, action });
    await user.click(button());

    expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗しました。時間をおいて再度お試しください');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('リツイート2件', { exact: true })).toBeInTheDocument();
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
            <RetweetButton tweetId={TWEET} active={false} count={0} expectedActorId={ME} action={vi.fn<Action>().mockRejectedValue(control)} />
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

  it('未ログインで表示した画面では画面の利用者を送らず、返された案内だけを3秒表示してその場に留まる', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { action, user } = setup({
        expectedActorId: null,
        action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'ログイン中のみリツイートできます' }),
      });
      await user.click(button());

      expect(await screen.findByRole('alert')).toHaveTextContent('ログイン中のみリツイートできます');
      expect(action.mock.calls[0][0].has('expectedActorId')).toBe(false);
      expect(button()).toHaveAttribute('aria-pressed', 'false');
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('成功時は通知を出さない（状態・件数は再取得したDBの値で表示する）', async () => {
    const { user } = setup();
    await user.click(button());
    await waitFor(() => expect(button()).toBeEnabled());

    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('サーバー描画の時点では無効で、操作できるようになってから有効にする', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(
      <ActionFeedbackProvider>
        <RetweetButton tweetId={TWEET} active={false} count={0} expectedActorId={ME} action={vi.fn()} />
      </ActionFeedbackProvider>,
    );
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe('TweetCardのリツイート', () => {
  it('通常カードとリツイートカードで同じ元投稿の状態・件数を表示し、どちらから押しても元投稿UUIDを送る', async () => {
    cardAction.mockReset().mockResolvedValue({ ok: true, active: false, count: 1 });
    const tweet = { retweetedByViewer: true, retweetCount: 2 };
    render(
      <ActionFeedbackProvider>
        <TweetCard item={item(tweet)} viewerId={ME} />
        <TweetCard item={item(tweet, { id: RETWEETER, name: 'キャロル', displayId: 'Carol_1' })} viewerId={ME} />
      </ActionFeedbackProvider>,
    );
    const [plain, retweeted] = screen.getAllByRole('article');
    for (const card of [plain, retweeted]) {
      expect(within(card).getByRole('button', { name: 'リツイートを解除' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(card).getByText('リツイート2件', { exact: true })).toBeInTheDocument();
    }

    const user = userEvent.setup();
    const unretweet = within(retweeted).getByRole('button', { name: 'リツイートを解除' });
    await waitFor(() => expect(unretweet).toBeEnabled());
    await user.click(unretweet);

    await waitFor(() => expect(cardAction).toHaveBeenCalledTimes(1));
    const data = cardAction.mock.calls[0][0] as FormData;
    expect(data.get('tweetId')).toBe(TWEET);
    expect(data.get('active')).toBe('false');
    expect(data.get('expectedActorId')).toBe(ME);
    // 表示中のリツイート行・その実行者は送らない
    expect([...data.values()]).not.toContain(RETWEET);
    expect([...data.values()]).not.toContain(RETWEETER);
  });

  it('リツイート→いいね→お気に入りの順に並べ、お気に入りの旗は右端のまま', () => {
    render(
      <ActionFeedbackProvider>
        <TweetCard item={item({ retweetCount: 4, likeCount: 5 })} viewerId={ME} />
      </ActionFeedbackProvider>,
    );
    const card = screen.getByRole('article');
    const retweet = within(card).getByRole('button', { name: 'リツイートする' });
    const like = within(card).getByRole('button', { name: 'いいねする' });
    const favorite = within(card).getByRole('button', { name: 'お気に入りに追加' });
    expect(retweet.compareDocumentPosition(like) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(like.compareDocumentPosition(favorite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText('リツイート4件', { exact: true })).toBeInTheDocument();
  });

  it('未ログインの閲覧者にも件数とボタンを表示する（本人状態はfalse）', () => {
    render(
      <ActionFeedbackProvider>
        <TweetCard item={item({ retweetCount: 1 })} viewerId={null} />
      </ActionFeedbackProvider>,
    );
    expect(screen.getByRole('button', { name: 'リツイートする' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('リツイート1件', { exact: true })).toBeInTheDocument();
  });
});
