import { describe, expect, it, vi } from 'vitest';
import { logout } from '@/application/usecases/auth/logout';
import type { SessionTerminator } from '@/domain/external_service_ifs/auth/session-terminator';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';

function sessions() {
  return { end: vi.fn<SessionTerminator['end']>().mockResolvedValue(true) };
}

describe('logout', () => {
  it('画面を表示したときと同じ利用者なら、現在のセッションを一度だけ終了する', async () => {
    const gateway = sessions();

    expect(await logout({ sessions: gateway }, { actorId: ALICE, expectedActorId: ALICE })).toEqual({ ok: true });
    expect(gateway.end).toHaveBeenCalledTimes(1);
    expect(gateway.end).toHaveBeenCalledWith();
  });

  it('既に匿名でも、残っている認証Cookieを清掃できるようセッション終了を呼ぶ', async () => {
    const gateway = sessions();

    expect(await logout({ sessions: gateway }, { actorId: null, expectedActorId: ALICE })).toEqual({ ok: true });
    expect(gateway.end).toHaveBeenCalledTimes(1);
  });

  it('別の利用者に切り替わっていれば、現在の利用者のセッションを終了しない', async () => {
    const gateway = sessions();

    expect(await logout({ sessions: gateway }, { actorId: BOB, expectedActorId: ALICE })).toEqual({
      ok: false,
      code: 'SESSION_CHANGED',
    });
    expect(gateway.end).not.toHaveBeenCalled();
  });

  it.each([ALICE, null])('終了を確認できなければ成功扱いせずUNAVAILABLEにする（actorId=%s）', async (actorId) => {
    const gateway = sessions();
    gateway.end.mockResolvedValue(false);

    expect(await logout({ sessions: gateway }, { actorId, expectedActorId: ALICE })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(gateway.end).toHaveBeenCalledTimes(1);
  });

  it.each([ALICE, null])('終了処理の例外は内容を漏らさずUNAVAILABLEにする（actorId=%s）', async (actorId) => {
    const gateway = sessions();
    gateway.end.mockRejectedValue(new Error('session gateway failed'));

    await expect(logout({ sessions: gateway }, { actorId, expectedActorId: ALICE })).resolves.toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(gateway.end).toHaveBeenCalledTimes(1);
  });
});
