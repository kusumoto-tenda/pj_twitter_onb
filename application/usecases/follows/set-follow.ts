import { normalizeUuid } from '@/shared/uuid';
import type { SetFollowResult } from '@/application/dtos/follows/follow';
import type { FollowRepository } from '@/domain/repository_ifs/follow-repository';

/**
 * 自分から対象者へのフォローを明示的に登録・解除する。
 * 操作時の利用者と画面表示時の利用者を照合し、UUIDの表記差で本人確認・自己フォロー禁止を回避させない。
 */
export async function setFollow(
  deps: { follows: FollowRepository; newId: () => string; now: () => Date },
  { actorId, expectedActorId, targetId, active }: {
    actorId: string | null;
    expectedActorId: string | null;
    targetId: string;
    active: boolean;
  },
): Promise<SetFollowResult> {
  if (actorId === null) return { ok: false, code: 'UNAUTHENTICATED' };
  if (expectedActorId === null) return { ok: false, code: 'SESSION_CHANGED' };
  const actor = normalizeUuid(actorId);
  const expected = normalizeUuid(expectedActorId);
  const target = normalizeUuid(targetId);
  if (actor === null || expected === null || target === null) return { ok: false, code: 'INVALID_REQUEST' };
  if (actor !== expected) return { ok: false, code: 'SESSION_CHANGED' };
  if (actor === target) return { ok: false, code: 'SELF_FOLLOW' };

  try {
    const outcome = await deps.follows.set({ actorId: actor, targetId: target, active, id: deps.newId(), now: deps.now() });
    if (outcome.status === 'set') return { ok: true, active: outcome.active };
    return { ok: false, code: outcome.status === 'actor-not-found' ? 'UNAUTHENTICATED' : 'NOT_FOUND' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
