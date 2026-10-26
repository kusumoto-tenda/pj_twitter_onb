import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TweetActionsMenu } from '@/app/ui/tweets/tweet-actions-menu';
import { TweetComposerProvider } from '@/app/ui/tweets/tweet-composer';

const TWEET = '00000000-0000-4000-8000-0000000000d1';

function setup(beginEdit = vi.fn(async () => ({ ok: false as const, message: 'x' }))) {
  render(
    <TweetComposerProvider
      beginDraft={vi.fn()}
      action={vi.fn()}
      beginEdit={beginEdit}
      updateAction={vi.fn()}
      uploader={{ upload: vi.fn(), discardUpload: vi.fn(async () => true), discardDraft: vi.fn() }}
    >
      <p>外側</p>
      <TweetActionsMenu tweetId={TWEET} menuKey="tweet:a" />
      <TweetActionsMenu tweetId={TWEET} menuKey="retweet:b" />
    </TweetComposerProvider>,
  );
  return { beginEdit, user: userEvent.setup() };
}

const buttons = () => screen.getAllByRole('button', { name: 'ツイートの操作' });

describe('TweetActionsMenu', () => {
  it('「ツイートの操作」を押すと「編集する」を表示し、選ぶと投稿IDで編集を始める', async () => {
    const { beginEdit, user } = setup();
    expect(buttons()[0]).toHaveAttribute('aria-haspopup', 'menu');
    expect(buttons()[0]).toHaveAttribute('aria-expanded', 'false');

    await user.click(buttons()[0]);
    expect(buttons()[0]).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('menuitem', { name: '編集する' }));

    expect(beginEdit).toHaveBeenCalledWith(TWEET);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('未実装の「削除する」「報告する」は出さない', async () => {
    const { user } = setup();
    await user.click(buttons()[0]);

    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });

  it('別のカードのメニューを開くと、先に開いていたメニューを閉じる', async () => {
    const { user } = setup();
    await user.click(buttons()[0]);
    await user.click(buttons()[1]);

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(buttons()[0]).toHaveAttribute('aria-expanded', 'false');
    expect(buttons()[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('Escで閉じてボタンにフォーカスを戻し、外側のクリックでも閉じる', async () => {
    const { user } = setup();
    await user.click(buttons()[0]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(buttons()[0]).toHaveFocus();

    await user.click(buttons()[0]);
    await user.click(screen.getByText('外側'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('キーボードだけで開いて「編集する」を選べる', async () => {
    const { beginEdit, user } = setup();
    buttons()[0].focus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '編集する' })).toHaveFocus());
    await user.keyboard('{Enter}');

    expect(beginEdit).toHaveBeenCalledWith(TWEET);
  });

  it('サーバー描画の時点では無効で、操作できるようになってから有効にする', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(
      <TweetComposerProvider beginDraft={vi.fn()} action={vi.fn()} uploader={{ upload: vi.fn(), discardUpload: vi.fn(async () => true), discardDraft: vi.fn() }}>
        <TweetActionsMenu tweetId={TWEET} menuKey="tweet:a" />
      </TweetComposerProvider>,
    );
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });
});
