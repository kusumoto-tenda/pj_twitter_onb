import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '@/app/ui/notifications/toast';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('triggerがnullなら表示しない', () => {
    render(<Toast message="こんにちは" tone="success" trigger={null} />);

    expect(screen.queryByText('こんにちは')).not.toBeInTheDocument();
  });

  it('成功はrole=statusで表示し、2999msでは表示・3000msで非表示にする', () => {
    render(<Toast message="アカウントを作成しました" tone="success" trigger={1} />);

    expect(screen.getByRole('status')).toHaveTextContent('アカウントを作成しました');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('失敗はrole=alertで表示する', () => {
    render(<Toast message="アカウントの作成に失敗しました" tone="error" trigger={1} />);

    expect(screen.getByRole('alert')).toHaveTextContent('アカウントの作成に失敗しました');
  });

  it('同じメッセージでもtriggerが変われば表示を再開し、そこから3秒で消える', () => {
    const { rerender } = render(<Toast message="失敗" tone="error" trigger={1} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<Toast message="失敗" tone="error" trigger={2} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));

    rerender(<Toast message="失敗" tone="error" trigger={3} />);
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
