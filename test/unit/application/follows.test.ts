import { describe, expect, it, vi } from 'vitest';
import { setFollow } from '@/application/usecases/follows/set-follow';
import type { FollowRepository } from '@/domain/repository_ifs/follow-repository';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';
const RELATION = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-10-27T03:00:00.000Z');
const request = { actorId: ALICE, expectedActorId: ALICE, targetId: BOB, active: true };

function setup() {
  const set = vi.fn<FollowRepository['set']>().mockImplementation(async ({ active }) => ({ status: 'set', active }));
  const deps = { follows: { set }, newId: vi.fn(() => RELATION), now: vi.fn(() => NOW) };
  return { set, deps };
}

describe('setFollow', () => {
  it.each([true, false])('active=%sをそのまま渡し、登録・解除の再送をトグルに変えない', async (active) => {
    const { set, deps } = setup();

    expect(await setFollow(deps, { ...request, active })).toEqual({ ok: true, active });
    expect(await setFollow(deps, { ...request, active })).toEqual({ ok: true, active });

    expect(set).toHaveBeenCalledTimes(2);
    for (const [input] of set.mock.calls) {
      expect(input).toEqual({ actorId: ALICE, targetId: BOB, active, id: RELATION, now: NOW });
    }
    expect(deps.newId).toHaveBeenCalledTimes(2);
    expect(deps.now).toHaveBeenCalledTimes(2);
  });

  it('actor・expectedActor・targetのUUIDを小文字に揃え、逆方向へ入れ替えず保存側へ渡す', async () => {
    const { set, deps } = setup();

    expect(await setFollow(deps, {
      ...request,
      actorId: ALICE.toUpperCase(),
      expectedActorId: ALICE.toUpperCase(),
      targetId: BOB.toUpperCase(),
      active: false,
    })).toEqual({ ok: true, active: false });
    expect(set).toHaveBeenCalledWith({ actorId: ALICE, targetId: BOB, active: false, id: RELATION, now: NOW });
  });

  it('未認証では保存側もUUID・時計も呼ばない', async () => {
    const { set, deps } = setup();

    expect(await setFollow(deps, { ...request, actorId: null, expectedActorId: null })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(set).not.toHaveBeenCalled();
    expect(deps.newId).not.toHaveBeenCalled();
    expect(deps.now).not.toHaveBeenCalled();
  });

  it.each([
    ['別アカウントに変わった', { actorId: BOB, expectedActorId: ALICE }],
    ['未ログインで表示した', { actorId: ALICE, expectedActorId: null }],
  ])('%s画面では自己判定より先にSESSION_CHANGEDとして拒否する', async (_label, actors) => {
    const { set, deps } = setup();

    expect(await setFollow(deps, { ...request, ...actors })).toEqual({ ok: false, code: 'SESSION_CHANGED' });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    ['actor', { actorId: 'nope' }],
    ['expectedActor', { expectedActorId: 'nope' }],
    ['target', { targetId: 'nope' }],
    ['空白付きtarget', { targetId: ` ${BOB}` }],
  ])('%sが不正なUUIDならINVALID_REQUESTで保存側を呼ばない', async (_label, invalid) => {
    const { set, deps } = setup();

    expect(await setFollow(deps, { ...request, ...invalid })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([true, false])('大小文字違いの自分宛てでもactive=%sはSELF_FOLLOWで保存側を呼ばない', async (active) => {
    const { set, deps } = setup();

    expect(await setFollow(deps, { ...request, targetId: ALICE.toUpperCase(), active })).toEqual({ ok: false, code: 'SELF_FOLLOW' });
    expect(await setFollow(deps, { ...request, actorId: ALICE.toUpperCase(), targetId: ALICE, active })).toEqual({ ok: false, code: 'SELF_FOLLOW' });
    expect(set).not.toHaveBeenCalled();
    expect(deps.newId).not.toHaveBeenCalled();
    expect(deps.now).not.toHaveBeenCalled();
  });

  it('保存側が返す確定済みの状態を返す', async () => {
    const { set, deps } = setup();
    set.mockResolvedValue({ status: 'set', active: false });

    expect(await setFollow(deps, request)).toEqual({ ok: true, active: false });
  });

  it.each([
    ['actor-not-found', 'UNAUTHENTICATED'],
    ['target-not-found', 'NOT_FOUND'],
  ] as const)('%sは%sへ変換する', async (status, code) => {
    const { set, deps } = setup();
    set.mockResolvedValue({ status });

    expect(await setFollow(deps, request)).toEqual({ ok: false, code });
  });

  it('DBの例外は詳細を漏らさずUNAVAILABLEへ変換する', async () => {
    const { set, deps } = setup();
    set.mockRejectedValue(new Error('private database details'));

    expect(await setFollow(deps, request)).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
