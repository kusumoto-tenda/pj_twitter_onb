import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggedOutFlash } from '@/app/ui/notifications/logged-out-flash';

const names = ['flash_session', 'flash_account', 'flash', 'flash_tweet'];
function clearCookies() {
  for (const name of names) document.cookie = `${name}=; path=/; max-age=0`;
}
beforeEach(() => { vi.useFakeTimers(); clearCookies(); });
afterEach(() => { vi.useRealTimers(); clearCookies(); });

describe('LoggedOutFlash', () => {
  it('ログアウト通知を3秒だけ表示し、Cookieを一度消費して削除する', () => {
    document.cookie = 'flash_session=logged-out; path=/';
    render(<LoggedOutFlash />);
    expect(screen.getByRole('status')).toHaveTextContent('ログアウトしました');
    expect(document.cookie).not.toContain('flash_session=');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('StrictModeでも1つだけ表示し、再マウント・再読込では再表示しない', () => {
    document.cookie = 'flash_session=logged-out; path=/';
    const first = render(<StrictMode><LoggedOutFlash /></StrictMode>);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    first.unmount();
    render(<LoggedOutFlash />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('他の通知や未知の値を消費・表示しない', () => {
    document.cookie = 'flash_session=unknown; path=/';
    document.cookie = 'flash_account=deleted; path=/';
    document.cookie = 'flash=account-created; path=/';
    document.cookie = 'flash_tweet=posted; path=/';
    render(<LoggedOutFlash />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    for (const name of names) expect(document.cookie).toContain(`${name}=`);
  });
});
