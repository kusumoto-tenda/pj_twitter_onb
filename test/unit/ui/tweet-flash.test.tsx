import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TweetFlash } from '@/app/ui/notifications/tweet-flash';

const clear = () => {
  for (const name of ['flash_tweet', 'flash', 'flash_profile', 'flash_account']) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  clear();
});
afterEach(() => {
  vi.useRealTimers();
  clear();
});

describe('TweetFlash', () => {
  it.each([
    ['posted', 'ツイートしました'],
    ['login-required', 'ツイートするにはログインしてください'],
    ['edit-login-required', 'ツイートを編集するにはログインしてください'],
  ])('%s の通知を3秒だけ表示し、Cookieを消費する', (value, message) => {
    document.cookie = `flash_tweet=${value}; path=/`;

    render(<TweetFlash />);

    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(document.cookie).not.toContain('flash_tweet=');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Strict Modeでも1つだけ表示し、再マウントでは再表示しない', () => {
    document.cookie = 'flash_tweet=posted; path=/';

    const first = render(
      <StrictMode>
        <TweetFlash />
      </StrictMode>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    first.unmount();
    render(<TweetFlash />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('登録・編集・削除の通知Cookieは消費しない', () => {
    document.cookie = 'flash=account-created; path=/';
    document.cookie = 'flash_profile=profile-updated; path=/';
    document.cookie = 'flash_account=deleted; path=/';

    render(<TweetFlash />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.cookie).toContain('flash=account-created');
    expect(document.cookie).toContain('flash_profile=profile-updated');
    expect(document.cookie).toContain('flash_account=deleted');
  });
});
