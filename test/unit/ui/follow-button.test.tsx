import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { redirect } from 'next/navigation';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SetFollowActionResult } from '@/app/follows/actions';
import { ActionFeedbackProvider } from '@/app/ui/notifications/action-feedback-provider';
import { FollowButton } from '@/app/ui/profile/follow-button';
import { ProfileHeader } from '@/app/ui/profile/profile-header';
import type { ProfileSummary } from '@/application/dtos/profile/profile';

// ルートのProviderを使う操作は、プロフィールから渡される本人UUIDだけを検証する。
vi.mock('@/app/ui/auth/logout-button', () => ({
  LogoutButton: ({ expectedActorId }: { expectedActorId: string }) => (
    <span data-testid="logout-button" data-actor={expectedActorId} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
// ヘッダーの送信先を差し替えて、どの値を送ったかを確かめる。
const headerAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/follows/actions', () => ({ setFollowAction: headerAction }));

const ME = '00000000-0000-4000-8000-0000000000a1';
const TARGET = '00000000-0000-4000-8000-0000000000b1';

type Action = (formData: FormData) => Promise<SetFollowActionResult>;

function setup({
  active = false,
  expectedActorId = ME as string | null,
  action = vi.fn<Action>().mockResolvedValue({ ok: true, active: !active }),
} = {}) {
  render(
    <ActionFeedbackProvider>
      <FollowButton targetId={TARGET} active={active} expectedActorId={expectedActorId} action={action} />
    </ActionFeedbackProvider>,
  );
  return { action, user: userEvent.setup() };
}

const button = () => screen.getByRole('button', { name: /^フォロー(する|解除)$/ });

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

const profile: ProfileSummary = {
  id: TARGET,
  name: 'ボブ',
  displayId: 'Bob_12',
  bio: '',
  createdAt: '2026-10-23T15:30:00.123456Z',
  followingCount: 2,
  followerCount: 3,
  followedByViewer: false,
};

describe('FollowButton', () => {
  it('未フォローは「フォローする」（aria-pressed=false）', () => {
    setup();
    expect(button()).toHaveAccessibleName('フォローする');
    expect(button()).toHaveTextContent('フォローする');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('フォロー中は「フォロー解除」（aria-pressed=true）', () => {
    setup({ active: true });
    expect(button()).toHaveAccessibleName('フォロー解除');
    expect(button()).toHaveTextContent('フォロー解除');
    expect(button()).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    [false, 'true'],
    [true, 'false'],
  ])('active=%sなら、次の状態（%s）を明示して対象のUUIDと画面の利用者だけを送る', async (active, next) => {
    const { action, user } = setup({ active });
    await user.click(button());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = action.mock.calls[0][0];
    expect([...data.keys()].sort()).toEqual(['active', 'expectedActorId', 'targetId']);
    expect(data.get('targetId')).toBe(TARGET);
    expect(data.get('active')).toBe(next);
    expect(data.get('expectedActorId')).toBe(ME);
  });

  it('処理中は押せず（連打しても1回だけ送る）、aria-busyで知らせる', async () => {
    const pending = deferred<SetFollowActionResult>();
    const { action, user } = setup({ action: vi.fn<Action>().mockReturnValue(pending.promise) });
    await user.click(button());
    await user.click(button());

    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute('aria-busy', 'true');
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true, active: true }));
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('Actionが失敗結果を返したら、状態を変えずに理由を3秒通知する', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = setup({
        action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'フォローを変更できませんでした。時間をおいて再度お試しください' }),
      });
      await user.click(button());

      expect(await screen.findByRole('alert')).toHaveTextContent('フォローを変更できませんでした。時間をおいて再度お試しください');
      expect(button()).toHaveAttribute('aria-pressed', 'false');
      expect(button()).toBeEnabled();
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Action自体がreject（通信の失敗など）しても状態を保ったまま通知し、同じ内容で再試行できる', async () => {
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
    expect(action.mock.calls[1][0].get('targetId')).toBe(TARGET);
  });

  it('Next.jsの制御例外（redirect）は失敗として通知せず、同じ値のままNext.jsへ渡す', async () => {
    const control = thrownBy(() => redirect('/login'));
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ActionFeedbackProvider>
          <Boundary onError={onError}>
            <FollowButton targetId={TARGET} active={false} expectedActorId={ME} action={vi.fn<Action>().mockRejectedValue(control)} />
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
        action: vi.fn<Action>().mockResolvedValue({ ok: false, message: 'ログイン中のみフォローできます' }),
      });
      await user.click(button());

      expect(await screen.findByRole('alert')).toHaveTextContent('ログイン中のみフォローできます');
      expect(action.mock.calls[0][0].has('expectedActorId')).toBe(false);
      expect(button()).toHaveAttribute('aria-pressed', 'false');
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('成功時は通知を出さず、状態は再取得したDBの値で表示する（楽観的に切り替えない）', async () => {
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
        <FollowButton targetId={TARGET} active={false} expectedActorId={ME} action={vi.fn()} />
      </ActionFeedbackProvider>,
    );
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe('ProfileHeaderのフォロー', () => {
  it('他人のプロフィールでは対象のUUID（閲覧者のUUIDではない）と画面の利用者を送る', async () => {
    headerAction.mockReset().mockResolvedValue({ ok: true, active: true });
    render(
      <ActionFeedbackProvider>
        <ProfileHeader profile={profile} isSelf={false} viewerId={ME} tab="followers" />
      </ActionFeedbackProvider>,
    );
    const follow = screen.getByRole('button', { name: 'フォローする' });
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(follow).toBeEnabled());
    await userEvent.setup().click(follow);

    await waitFor(() => expect(headerAction).toHaveBeenCalledTimes(1));
    const data = headerAction.mock.calls[0][0] as FormData;
    expect(data.get('targetId')).toBe(TARGET);
    expect(data.get('expectedActorId')).toBe(ME);
    expect(data.get('active')).toBe('true');
  });

  it('フォロー中の他人には「フォロー解除」を表示する', () => {
    render(
      <ActionFeedbackProvider>
        <ProfileHeader profile={{ ...profile, followedByViewer: true }} isSelf={false} viewerId={ME} tab="tweets" />
      </ActionFeedbackProvider>,
    );
    expect(screen.getByRole('button', { name: 'フォロー解除' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('未ログインでも他人のプロフィールにボタンを表示する', () => {
    render(
      <ActionFeedbackProvider>
        <ProfileHeader profile={profile} isSelf={false} viewerId={null} tab="tweets" />
      </ActionFeedbackProvider>,
    );
    expect(screen.getByRole('button', { name: 'フォローする' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('自分のプロフィールにはフォローボタンを出さず、本人のログアウトを表示する', () => {
    render(
      <ActionFeedbackProvider>
        <ProfileHeader profile={{ ...profile, id: ME }} isSelf viewerId={ME} tab="tweets" />
      </ActionFeedbackProvider>,
    );
    expect(screen.queryByRole('button', { name: /^フォロー/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('logout-button')).toHaveAttribute('data-actor', ME);
  });
});
