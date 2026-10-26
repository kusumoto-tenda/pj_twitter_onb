import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SetFavoriteActionResult } from '@/app/favorites/actions';
import { FavoriteButton } from '@/app/ui/favorites/favorite-button';
import { FavoriteList } from '@/app/ui/favorites/favorite-list';
import { ActionFeedbackProvider } from '@/app/ui/notifications/action-feedback-provider';

vi.mock('@/app/ui/tweets/tweet-actions-menu', () => ({ TweetActionsMenu: () => null }));

const TWEET = '00000000-0000-4000-8000-0000000000d1';
const ME = '00000000-0000-4000-8000-0000000000a1';

type Action = (formData: FormData) => Promise<SetFavoriteActionResult>;

function setup({
  active = false,
  expectedActorId = ME as string | null,
  action = vi.fn<Action>().mockResolvedValue({ ok: true, active: !active }),
} = {}) {
  render(
    <ActionFeedbackProvider>
      <FavoriteButton tweetId={TWEET} active={active} expectedActorId={expectedActorId} action={action} />
    </ActionFeedbackProvider>,
  );
  return { action, user: userEvent.setup() };
}

const button = () => screen.getByRole('button', { name: /お気に入り/ });

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('FavoriteButton', () => {
  it('保存していなければ「お気に入りに追加」（aria-pressed=false）、保存済みなら「お気に入りを解除」（true）', () => {
    setup();
    expect(button()).toHaveAccessibleName('お気に入りに追加');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('保存済みの表示', () => {
    setup({ active: true });
    expect(button()).toHaveAccessibleName('お気に入りを解除');
    expect(button()).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    [false, 'true'],
    [true, 'false'],
  ])('active=%sなら、次の状態（%s）を明示して投稿IDと画面の利用者と一緒に送る', async (active, next) => {
    const { action, user } = setup({ active });
    await user.click(button());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = action.mock.calls[0][0];
    expect([...data.keys()].sort()).toEqual(['active', 'expectedActorId', 'tweetId']);
    expect(data.get('tweetId')).toBe(TWEET);
    expect(data.get('active')).toBe(next);
    expect(data.get('expectedActorId')).toBe(ME);
  });

  it('処理中は押せず（連打しても1回だけ送る）、aria-busyで知らせる', async () => {
    const pending = deferred<SetFavoriteActionResult>();
    const { action, user } = setup({ action: vi.fn<Action>().mockReturnValue(pending.promise) });
    await user.click(button());
    await user.click(button());

    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute('aria-busy', 'true');
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true, active: true }));
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('Actionが失敗結果を返したら、表示中の状態を変えずに理由を3秒通知する', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = setup({
        action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'お気に入りを変更できませんでした。時間をおいて再度お試しください' }),
      });
      await user.click(button());

      expect(await screen.findByRole('alert')).toHaveTextContent('お気に入りを変更できませんでした。時間をおいて再度お試しください');
      expect(button()).toHaveAttribute('aria-pressed', 'false');
      expect(button()).toBeEnabled();
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Action自体がreject（通信の失敗など）しても画面を置き換えず、状態を保ったまま通知し、再試行できる', async () => {
    const action = vi
      .fn<Action>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, active: true });
    const { user } = setup({ action });
    await user.click(button());

    expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗しました。時間をおいて再度お試しください');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(button()).toBeEnabled());

    await user.click(button());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1][0].get('active')).toBe('true');
  });

  it('未ログインで表示した画面では画面の利用者を送らず、返された案内だけを表示する', async () => {
    const { action, user } = setup({
      expectedActorId: null,
      action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'ログイン中のみお気に入りに設定できます' }),
    });
    await user.click(button());

    expect(await screen.findByRole('alert')).toHaveTextContent('ログイン中のみお気に入りに設定できます');
    expect(action.mock.calls[0][0].has('expectedActorId')).toBe(false);
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('成功時は通知を出さない（状態は再取得したDBの値で表示する）', async () => {
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
        <FavoriteButton tweetId={TWEET} active={false} expectedActorId={ME} action={vi.fn()} />
      </ActionFeedbackProvider>,
    );
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe('FavoriteList', () => {
  it('空なら案内を出し、あれば保存済みの元投稿カードを表示する', () => {
    const { rerender } = render(
      <ActionFeedbackProvider>
        <FavoriteList items={[]} viewerId={ME} />
      </ActionFeedbackProvider>,
    );
    expect(screen.getByText('お気に入りはまだありません')).toBeInTheDocument();

    rerender(
      <ActionFeedbackProvider>
        <FavoriteList
          viewerId={ME}
          items={[
            {
              favoriteId: '00000000-0000-4000-8000-0000000000f1',
              favoritedAt: '2026-10-26T03:00:00.000000Z',
              item: {
                key: { eventAt: '2026-10-25T03:00:00.000000Z', kind: 'tweet', eventId: TWEET },
                tweet: {
                  id: TWEET,
                  content: '保存した投稿',
                  author: { id: ME, name: 'アリス', displayId: 'Alice_1' },
                  createdAt: '2026-10-25T03:00:00.000000Z',
                  images: [],
                  favoritedByViewer: true,
                  likedByViewer: false,
                  likeCount: 0,
                  retweetedByViewer: false,
                  retweetCount: 0,
                },
                retweetedBy: null,
              },
            },
          ]}
        />
      </ActionFeedbackProvider>,
    );
    expect(screen.getByRole('article')).toHaveTextContent('保存した投稿');
    expect(screen.getByRole('button', { name: 'お気に入りを解除' })).toHaveAttribute('aria-pressed', 'true');
  });
});
