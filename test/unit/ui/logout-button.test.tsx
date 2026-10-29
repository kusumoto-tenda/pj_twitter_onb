import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogoutFormState } from '@/app/logout/form-state';
import { LogoutButton } from '@/app/ui/auth/logout-button';
import { ActionFeedbackProvider } from '@/app/ui/notifications/action-feedback-provider';
import { LOGGED_OUT_MESSAGE, LOGOUT_FAILED_MESSAGE } from '@/app/ui/notifications/flash';
import { ProfileHeader } from '@/app/ui/profile/profile-header';
import { MainNavigation } from '@/app/ui/timeline/main-navigation';
import { CreateTweetLauncher } from '@/app/ui/tweets/create-tweet-launcher';
import { TweetComposerProvider, useTweetComposer } from '@/app/ui/tweets/tweet-composer';
import type { ProfileSummary } from '@/application/dtos/profile/profile';
import { CaptureBoundary, redirectError } from '../../support/next-control';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
// ProfileHeaderの既定のActionは本物のServer Actionを読み込まないよう差し替える。
const defaultAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/logout/actions', () => ({ logoutAction: defaultAction }));
vi.mock('@/app/follows/actions', () => ({ setFollowAction: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000a1';
const DRAFT = '00000000-0000-4000-8000-0000000000d1';

type Action = (previous: LogoutFormState, formData: FormData) => Promise<LogoutFormState>;
type BeginDraft = () => Promise<{ ok: true; draftId: string } | { ok: false; message: string }>;

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 未解決のActionを次のテストへ残すと、Reactが後続のTransitionまで待ち続ける。
const finishPendingActions: Array<() => void> = [];
function pendingAction(): Promise<LogoutFormState> {
  const gate = deferred<LogoutFormState>();
  finishPendingActions.push(() => gate.resolve({ status: 'idle' }));
  return gate.promise;
}

afterEach(async () => {
  await act(async () => {
    finishPendingActions.splice(0).forEach((finish) => finish());
  });
});

/** テストからProviderの操作を同じ同期処理の中で呼ぶための窓口。 */
let composer: ReturnType<typeof useTweetComposer> | null = null;
function ComposerProbe() {
  composer = useTweetComposer();
  return null;
}

function Providers({ children, beginDraft }: { children: ReactNode; beginDraft: BeginDraft }) {
  return (
    <ActionFeedbackProvider>
      <TweetComposerProvider
        beginDraft={beginDraft}
        action={vi.fn()}
        beginEdit={vi.fn()}
        updateAction={vi.fn()}
        beginDelete={vi.fn()}
        deleteAction={vi.fn()}
        uploader={{ upload: vi.fn(), discardUpload: vi.fn(async () => true), discardDraft: vi.fn() }}
      >
        <ComposerProbe />
        {children}
      </TweetComposerProvider>
    </ActionFeedbackProvider>
  );
}

function setup({
  action = vi.fn<Action>().mockReturnValue(pendingAction()),
  beginDraft = vi.fn<BeginDraft>().mockResolvedValue({ ok: true, draftId: DRAFT }),
  strict = false,
  onBoundaryError,
}: {
  action?: ReturnType<typeof vi.fn<Action>>;
  beginDraft?: ReturnType<typeof vi.fn<BeginDraft>>;
  strict?: boolean;
  onBoundaryError?: (error: unknown) => void;
} = {}) {
  const content = (
    <>
      <CreateTweetLauncher />
      <LogoutButton expectedActorId={ME} action={action} />
    </>
  );
  const bounded = onBoundaryError ? <CaptureBoundary onError={onBoundaryError}>{content}</CaptureBoundary> : content;
  const tree = <Providers beginDraft={beginDraft}>{bounded}</Providers>;
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { action, beginDraft, view, user: userEvent.setup() };
}

const logoutButton = () => screen.getByRole('button', { name: /^ログアウト/ });
const launcher = () => screen.getByRole('button', { name: 'ツイートする' });
const errorState = (attempt: number, message = LOGOUT_FAILED_MESSAGE): LogoutFormState => ({
  status: 'error',
  code: 'UNAVAILABLE',
  message,
  attempt,
});

describe('LogoutButton', () => {
  it('POSTのformで、表示時の利用者UUIDだけを送る（Linkでは実行しない）', async () => {
    const { action, user } = setup();
    expect(screen.queryByRole('link', { name: /ログアウト/ })).toBeNull();
    expect(logoutButton()).toHaveAttribute('type', 'submit');
    expect(logoutButton().closest('form')).not.toBeNull();

    await user.click(logoutButton());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const [previous, formData] = action.mock.calls[0];
    expect(previous).toEqual({ status: 'idle' });
    expect([...formData.keys()].filter((key) => !key.startsWith('$'))).toEqual(['expectedActorId']);
    expect(formData.get('expectedActorId')).toBe(ME);
  });

  it('処理中は「ログアウト中…」で無効になり、連打しても1回だけ送る', async () => {
    const { action, user } = setup();
    await user.click(logoutButton());
    await waitFor(() => expect(logoutButton()).toHaveTextContent('ログアウト中…'));
    expect(logoutButton()).toBeDisabled();
    expect(logoutButton()).toHaveAttribute('aria-busy', 'true');
    await user.click(logoutButton());
    act(() => logoutButton().closest('form')!.requestSubmit());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('失敗結果はその場で通知し、成功通知を出さず、再試行では前回の状態を渡す', async () => {
    const action = vi
      .fn<Action>()
      .mockResolvedValueOnce(errorState(1))
      .mockReturnValueOnce(pendingAction());
    const { user } = setup({ action });

    await user.click(logoutButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(LOGOUT_FAILED_MESSAGE);
    expect(screen.queryByText(LOGGED_OUT_MESSAGE)).toBeNull();
    await waitFor(() => expect(logoutButton()).toBeEnabled());
    expect(logoutButton()).toHaveTextContent('ログアウト');

    await user.click(logoutButton());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1][0]).toEqual(errorState(1));
  });

  it('利用者が変わった失敗はActionの文言で通知する', async () => {
    const message = 'ログイン中の利用者が変わりました。画面を開き直してください';
    const action = vi.fn<Action>().mockResolvedValue({ status: 'error', code: 'SESSION_CHANGED', message, attempt: 1 });
    const { user } = setup({ action });
    await user.click(logoutButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('通信の切断などの一般的なrejectは失敗として通知し、エラー境界へ投げず再試行できる', async () => {
    const onBoundaryError = vi.fn();
    const action = vi
      .fn<Action>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(pendingAction());
    const { user } = setup({ action, onBoundaryError });

    await user.click(logoutButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(LOGOUT_FAILED_MESSAGE);
    expect(onBoundaryError).not.toHaveBeenCalled();
    await waitFor(() => expect(logoutButton()).toBeEnabled());
    // 一般的な失敗後も投稿ダイアログを開ける（ロックを解除する）
    expect(launcher()).toBeEnabled();

    await user.click(logoutButton());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1][0]).toMatchObject({ status: 'error', code: 'UNAVAILABLE', attempt: 1 });
  });

  it('Next.jsの制御例外（redirect）は失敗として通知せず、同じ値のまま再throwする', async () => {
    const control = redirectError('/login');
    const onBoundaryError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { user } = setup({ action: vi.fn<Action>().mockRejectedValue(control), onBoundaryError });
      await user.click(logoutButton());
      await waitFor(() => expect(onBoundaryError).toHaveBeenCalledWith(control));
      expect(screen.queryByText(LOGOUT_FAILED_MESSAGE)).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('StrictModeでも失敗の通知は1回だけ', async () => {
    const action = vi.fn<Action>().mockResolvedValue(errorState(1));
    const { user } = setup({ action, strict: true });
    await user.click(logoutButton());
    await screen.findByRole('alert');
    expect(screen.getAllByText(LOGOUT_FAILED_MESSAGE)).toHaveLength(1);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('LogoutButtonと投稿ダイアログの排他', () => {
  it.each(['error', 'reject'] as const)('外れたボタンの遅い%sは、新しいログアウトのロックを解除せず通知もしない', async (mode) => {
    const old = deferred<LogoutFormState>();
    const current = deferred<LogoutFormState>();
    const oldMessage = '古いログアウトの失敗';
    // 途中のassertionが失敗しても、未解決のTransitionを後続テストへ残さない。
    finishPendingActions.push(() => old.resolve(errorState(1, oldMessage)), () => current.resolve({ status: 'idle' }));
    const oldAction = vi.fn<Action>().mockReturnValue(old.promise);
    const currentAction = vi.fn<Action>().mockReturnValue(current.promise);
    const { view, user, beginDraft } = setup({ action: oldAction });

    try {
      await user.click(logoutButton());
      await waitFor(() => expect(oldAction).toHaveBeenCalledTimes(1));
      view.rerender(
        <Providers beginDraft={beginDraft}>
          <CreateTweetLauncher />
          <LogoutButton key="new-owner" expectedActorId={ME} action={currentAction} />
        </Providers>,
      );
      await waitFor(() => expect(logoutButton()).toBeEnabled());
      await user.click(logoutButton());
      await waitFor(() => expect(currentAction).toHaveBeenCalledTimes(1));

      await act(async () => {
        if (mode === 'error') old.resolve(errorState(1, oldMessage));
        else old.reject(new TypeError('Failed to fetch'));
      });

      expect(logoutButton()).toBeDisabled();
      expect(logoutButton()).toHaveTextContent('ログアウト中…');
      expect(launcher()).toBeDisabled();
      act(() => composer!.open());
      expect(beginDraft).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      await act(async () => {
        old.resolve(errorState(1, oldMessage));
        current.resolve({ status: 'idle' });
      });
    }
  });

  it('ダイアログの準備中・表示中はログアウトを押せず、閉じたら押せる', async () => {
    const begin = deferred<{ ok: true; draftId: string }>();
    const { action, user } = setup({ beginDraft: vi.fn<BeginDraft>().mockReturnValue(begin.promise) });

    await user.click(launcher());
    expect(logoutButton()).toBeDisabled();
    act(() => logoutButton().closest('form')!.requestSubmit());
    expect(action).not.toHaveBeenCalled();

    await act(async () => begin.resolve({ ok: true, draftId: DRAFT }));
    const dialog = await screen.findByRole('dialog', { name: 'ツイートを作成' });
    expect(logoutButton()).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(logoutButton()).toBeEnabled());
    await user.click(logoutButton());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it('準備を始めた同じ同期処理の中のログアウトも送らない', async () => {
    const { action, beginDraft } = setup({ beginDraft: vi.fn<BeginDraft>().mockReturnValue(new Promise(() => {})) });
    await waitFor(() => expect(logoutButton()).toBeEnabled());
    act(() => {
      composer!.open();
      logoutButton().closest('form')!.requestSubmit();
    });
    expect(beginDraft).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it('ログアウト処理中は投稿・編集・削除のダイアログを準備しない（同じ同期処理の中でも）', async () => {
    const { action, beginDraft, user } = setup();
    await waitFor(() => expect(logoutButton()).toBeEnabled());
    act(() => {
      logoutButton().closest('form')!.requestSubmit();
      composer!.open();
    });
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(launcher()).toBeDisabled();
    await user.click(launcher());
    act(() => {
      composer!.open();
      composer!.openEdit(DRAFT, 'tweet:a');
      composer!.openDelete(DRAFT, 'tweet:a');
    });
    expect(beginDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('成功してボタンが外れたら（/loginへの移動）ロックを解除する', async () => {
    const { action, beginDraft, view, user } = setup();
    await user.click(logoutButton());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(launcher()).toBeDisabled();

    view.rerender(
      <Providers beginDraft={beginDraft}>
        <CreateTweetLauncher />
      </Providers>,
    );
    await waitFor(() => expect(launcher()).toBeEnabled());
  });
});

describe('ナビとプロフィールの配置', () => {
  const profile: ProfileSummary = {
    id: ME,
    name: 'アリス',
    displayId: 'Alice_1',
    bio: '',
    createdAt: '2026-10-23T15:30:00.123456Z',
    followingCount: 0,
    followerCount: 0,
    followedByViewer: false,
  };

  it('ナビは渡された操作（投稿・ログアウト）を末尾に置く', () => {
    render(
      <Providers beginDraft={vi.fn()}>
        <MainNavigation activePage="home" profileHref="/profile/Alice_1">
          <LogoutButton expectedActorId={ME} action={vi.fn()} />
        </MainNavigation>
      </Providers>,
    );
    const nav = screen.getByRole('navigation', { name: 'メインメニュー' });
    expect(within(nav).getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
  });

  it('自分のプロフィールでは編集リンクの近くに、検証済みのprofile.idで同じActionのボタンを置く', async () => {
    defaultAction.mockReturnValue(pendingAction());
    render(
      <Providers beginDraft={vi.fn()}>
        <ProfileHeader profile={profile} isSelf viewerId={ME} tab="tweets" />
      </Providers>,
    );
    const header = screen.getByRole('region', { name: 'プロフィール' });
    const button = within(header).getByRole('button', { name: 'ログアウト' });
    const editLink = within(header).getByRole('link', { name: 'プロフィール編集' });
    expect(button.closest('div')).toBe(editLink.closest('div'));
    expect(within(header).queryByRole('link', { name: 'アカウント削除' })).not.toBeInTheDocument();

    await userEvent.setup().click(button);
    await waitFor(() => expect(defaultAction).toHaveBeenCalledTimes(1));
    expect(defaultAction.mock.calls[0][1].get('expectedActorId')).toBe(ME);
  });

  it('他人のプロフィールにはログアウトを出さない', () => {
    render(
      <Providers beginDraft={vi.fn()}>
        <ProfileHeader profile={{ ...profile, id: '00000000-0000-4000-8000-0000000000b1' }} isSelf={false} viewerId={ME} tab="tweets" />
      </Providers>,
    );
    expect(screen.queryByRole('button', { name: /ログアウト/ })).toBeNull();
  });
});
