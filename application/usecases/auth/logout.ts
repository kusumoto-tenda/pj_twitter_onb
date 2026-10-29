import type { SessionTerminator } from '@/domain/external_service_ifs/auth/session-terminator';

export type LogoutResult = { ok: true } | { ok: false; code: 'SESSION_CHANGED' | 'UNAVAILABLE' };

/** 別の利用者へ切り替わっていなければ、匿名でも現在のブラウザのセッションを終了する。 */
export async function logout(
  deps: { sessions: SessionTerminator },
  input: { actorId: string | null; expectedActorId: string },
): Promise<LogoutResult> {
  if (input.actorId !== null && input.actorId !== input.expectedActorId) {
    return { ok: false, code: 'SESSION_CHANGED' };
  }
  try {
    return (await deps.sessions.end()) ? { ok: true } : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
