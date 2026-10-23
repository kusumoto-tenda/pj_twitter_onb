import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCreatedFlash } from '@/app/ui/notifications/account-created-flash';

function setFlashCookie() {
  document.cookie = 'flash=account-created; path=/';
}

beforeEach(() => {
  vi.useFakeTimers();
  document.cookie = 'flash=; path=/; max-age=0';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AccountCreatedFlash', () => {
  it('通知Cookieがあれば成功通知を3秒表示し、Cookieを削除する', () => {
    setFlashCookie();

    render(<AccountCreatedFlash />);

    expect(screen.getByRole('status')).toHaveTextContent('アカウントを作成しました');
    expect(document.cookie).not.toContain('flash=account-created');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('通知Cookieがなければ表示しない', () => {
    render(<AccountCreatedFlash />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Strict Modeの二重effectでも通知は1つだけ表示する', () => {
    setFlashCookie();

    render(
      <StrictMode>
        <AccountCreatedFlash />
      </StrictMode>,
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('再読込（再マウント）では再表示しない', () => {
    setFlashCookie();
    const first = render(<AccountCreatedFlash />);
    first.unmount();

    render(<AccountCreatedFlash />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('別のflash値は消費しない', () => {
    document.cookie = 'flash=other; path=/';

    render(<AccountCreatedFlash />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.cookie).toContain('flash=other');
    document.cookie = 'flash=; path=/; max-age=0';
  });
});
