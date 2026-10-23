import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileUpdatedFlash } from '@/app/ui/notifications/profile-updated-flash';

const clearCookies = () => {
  document.cookie = 'flash_profile=; path=/; max-age=0';
  document.cookie = 'flash=; path=/; max-age=0';
};

beforeEach(() => {
  vi.useFakeTimers();
  clearCookies();
});
afterEach(() => {
  vi.useRealTimers();
  clearCookies();
});

describe('ProfileUpdatedFlash', () => {
  it('専用の通知Cookieがあれば「プロフィールを更新しました」を3秒表示し、Cookieを削除する', () => {
    document.cookie = 'flash_profile=profile-updated; path=/';

    render(<ProfileUpdatedFlash />);

    expect(screen.getByRole('status')).toHaveTextContent('プロフィールを更新しました');
    expect(document.cookie).not.toContain('flash_profile=profile-updated');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Strict Modeでも1つだけ表示し、再マウントでは再表示しない', () => {
    document.cookie = 'flash_profile=profile-updated; path=/';

    const first = render(
      <StrictMode>
        <ProfileUpdatedFlash />
      </StrictMode>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    first.unmount();

    render(<ProfileUpdatedFlash />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('登録用の通知Cookieは消費しない', () => {
    document.cookie = 'flash=account-created; path=/';

    render(<ProfileUpdatedFlash />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.cookie).toContain('flash=account-created');
  });
});
