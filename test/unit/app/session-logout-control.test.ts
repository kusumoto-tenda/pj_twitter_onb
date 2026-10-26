import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const A = '00000000-0000-4000-8000-ABCDEF000001';
const boundary = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/app/_auth/auth', () => ({ auth: boundary.auth }));
// ナビのログアウト導線は利用者DBの実在確認に依存しない。
vi.mock('@/app/_composition/account', () => ({ getAccountDependencies: () => { throw new Error('DB must not be opened'); } }));
vi.mock('@/infra/db/client', () => ({ getSql: () => { throw new Error('DB must not be opened'); } }));
vi.mock('@/app/ui/auth/logout-button', () => ({ LogoutButton: () => null }));

const { SessionLogoutControl } = await import('@/app/ui/auth/session-logout-control');
const { LogoutButton } = await import('@/app/ui/auth/logout-button');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('SessionLogoutControl', () => {
  it('認証済みならセッションのUUID（正規化済み）をexpectedActorIdとしてボタンへ渡す', async () => {
    boundary.auth.mockResolvedValue({ user: { id: A } });
    const element = (await SessionLogoutControl()) as ReactElement<{ expectedActorId: string }>;
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(LogoutButton);
    expect(element.props.expectedActorId).toBe(A.toLowerCase());
  });

  it.each([
    ['セッションなし', null],
    ['利用者IDなし', { user: {} }],
    ['空の利用者ID', { user: { id: '' } }],
  ])('匿名（%s）ならボタンを出さない', async (_, session) => {
    boundary.auth.mockResolvedValue(session);
    expect(await SessionLogoutControl()).toBeNull();
  });

  it('認証処理そのものが失敗したら、ボタンを出さず再試行を案内する', async () => {
    boundary.auth.mockRejectedValue(new Error('auth failed'));
    const element = (await SessionLogoutControl()) as ReactElement<{ children: string }>;
    expect(isValidElement(element)).toBe(true);
    expect(element.type).not.toBe(LogoutButton);
    expect(element.props.children).toBe('ログイン状態を確認できませんでした。再読み込みしてください');
  });

  it('UUIDとして不正なセッションIDは確認できない状態として扱い、ボタンを出さない', async () => {
    boundary.auth.mockResolvedValue({ user: { id: 'not-a-uuid' } });
    const element = (await SessionLogoutControl()) as ReactElement<{ children: string }>;
    expect(element.type).not.toBe(LogoutButton);
    expect(element.props.children).toBe('ログイン状態を確認できませんでした。再読み込みしてください');
  });
});
