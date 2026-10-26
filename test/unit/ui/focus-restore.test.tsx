import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DeleteTweetFormState } from '@/app/tweets/delete-form-state';
import type { EditTweetFormState } from '@/app/tweets/edit-form-state';
import { TweetActionsMenu } from '@/app/ui/tweets/tweet-actions-menu';
import { TweetComposerProvider } from '@/app/ui/tweets/tweet-composer';

const TWEET = '00000000-0000-4000-8000-0000000000d1';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';

/** Server Action後の再取得を模して、一覧（見出し・カード）を読み込み表示に置き換えたり戻したりする。 */
const page = { setLoading: (_loading: boolean) => {}, remount: () => {} };

function List() {
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  page.setLoading = setLoading;
  page.remount = () => setGeneration((g) => g + 1);
  return (
    <main>
      <button type="button">ほかの操作</button>
      {loading ? (
        <div aria-busy="true">読み込み中</div>
      ) : (
        <div key={generation}>
          <h1>最新ツイート</h1>
          <TweetActionsMenu tweetId={TWEET} menuKey="tweet:a" />
        </div>
      )}
    </main>
  );
}

function setup() {
  const updateAction = vi.fn(async (): Promise<EditTweetFormState> => {
    act(() => page.setLoading(true));
    return { status: 'success', tweetId: TWEET, attempt: 1 };
  });
  const deleteAction = vi.fn(async (): Promise<DeleteTweetFormState> => {
    act(() => page.setLoading(true));
    return { status: 'success', attempt: 1 };
  });
  render(
    <TweetComposerProvider
      beginDraft={vi.fn()}
      action={vi.fn()}
      beginEdit={vi.fn(async () => ({ ok: true as const, value: { draftId: 'd1', tweetId: TWEET, content: '本文', images: [] } }))}
      updateAction={updateAction}
      beginDelete={vi.fn(async () => ({ ok: true as const, value: { tweetId: TWEET, actorId: ACTOR, content: '本文' } }))}
      deleteAction={deleteAction}
      uploader={{ upload: vi.fn(), discardUpload: vi.fn(async () => true), discardDraft: vi.fn() }}
    >
      <List />
    </TweetComposerProvider>,
  );
  return { user: userEvent.setup() };
}

const menuButton = () => screen.getByRole('button', { name: 'ツイートの操作' });
const nextFrames = () => act(() => new Promise((r) => setTimeout(r, 50)));

async function openFromMenu(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(menuButton());
  await user.click(screen.getByRole('menuitem', { name: item }));
  await screen.findByRole('dialog');
}

describe('ダイアログを閉じた後のフォーカス復帰', () => {
  it('更新後に一覧が読み込み中でも、起動元のボタンが再表示されたらフォーカスを戻す', async () => {
    const { user } = setup();
    await openFromMenu(user, '編集する');
    await user.click(screen.getByRole('button', { name: '更新' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await nextFrames();
    expect(screen.queryByRole('button', { name: 'ツイートの操作' })).not.toBeInTheDocument();

    act(() => page.setLoading(false));

    await waitFor(() => expect(menuButton()).toHaveFocus());
  });

  it('削除を取り消した直後に一覧が読み込み中でも、起動元のボタンが再表示されたらフォーカスを戻す', async () => {
    const { user } = setup();
    await openFromMenu(user, '削除する');
    act(() => page.setLoading(true));
    await user.click(screen.getByRole('button', { name: 'いいえ' }));
    await nextFrames();

    act(() => page.setLoading(false));

    await waitFor(() => expect(menuButton()).toHaveFocus());
  });

  it('削除後に一覧が読み込み中でも、見出しが再表示されたらフォーカスを移す', async () => {
    const { user } = setup();
    await openFromMenu(user, '削除する');
    await user.click(screen.getByRole('button', { name: 'はい' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await nextFrames();

    act(() => page.setLoading(false));

    await waitFor(() => expect(screen.getByRole('heading', { name: '最新ツイート' })).toHaveFocus());
  });

  it('再表示の前に利用者が別の場所へフォーカスを移していたら、奪わない', async () => {
    const { user } = setup();
    await openFromMenu(user, '編集する');
    await user.click(screen.getByRole('button', { name: '更新' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'ほかの操作' }));

    act(() => page.setLoading(false));
    await nextFrames();

    expect(screen.getByRole('button', { name: 'ほかの操作' })).toHaveFocus();
  });

  it('フォーカスを戻した直後にボタンが作り直されても、新しいボタンへフォーカスを戻す', async () => {
    const { user } = setup();
    await openFromMenu(user, '編集する');
    await user.click(screen.getByRole('button', { name: '更新' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    act(() => page.setLoading(false));
    await waitFor(() => expect(menuButton()).toHaveFocus());
    const first = menuButton();

    act(() => page.remount());

    await waitFor(() => expect(menuButton()).toHaveFocus());
    expect(menuButton()).not.toBe(first);
  });
});
