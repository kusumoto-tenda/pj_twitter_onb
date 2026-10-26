import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletedFlash } from '@/app/ui/notifications/account-deleted-flash';

const clearCookies = () => {
  for (const name of ['flash_account', 'flash', 'flash_profile']) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  clearCookies();
});
afterEach(() => {
  vi.useRealTimers();
  clearCookies();
});

describe('AccountDeletedFlash', () => {
  it('削除成功の通知を3秒だけ表示し、Cookieを削除する', () => {
    document.cookie = 'flash_account=deleted; path=/';

    render(<AccountDeletedFlash />);

    expect(screen.getByRole('status')).toHaveTextContent('アカウントを削除しました');
    expect(document.cookie).not.toContain('flash_account=');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Strict Modeでも1つだけ表示し、再読み込み（再マウント）では再表示しない', () => {
    document.cookie = 'flash_account=deleted; path=/';

    const first = render(
      <StrictMode>
        <AccountDeletedFlash />
      </StrictMode>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    first.unmount();

    render(<AccountDeletedFlash />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['signout-failed', 'アカウントは削除済みですが、ログアウト処理を完了できませんでした'],
    ['account-missing', 'アカウントを確認できません。再度ログインしてください'],
  ])('%s は成功の通知と混同せず、消えない固定表示にする', (value, message) => {
    document.cookie = `flash_account=${value}; path=/`;

    render(<AccountDeletedFlash />);

    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent(message);
    expect(screen.queryByText('アカウントを削除しました')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(document.cookie).not.toContain('flash_account=');
  });

  it('他の通知Cookieや未知の値は消費しない', () => {
    document.cookie = 'flash=account-created; path=/';
    document.cookie = 'flash_profile=profile-updated; path=/';
    document.cookie = 'flash_account=unknown; path=/';

    render(<AccountDeletedFlash />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.cookie).toContain('flash=account-created');
    expect(document.cookie).toContain('flash_profile=profile-updated');
  });
});
