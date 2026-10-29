import type { FollowRepository } from '@/domain/repository_ifs/follow-repository';

type Follow = { id: string; followerId: string; followId: string; createdAt: Date };

/** 実DBと同じ規則（方向ごとに1行、冪等な登録・解除、逆方向には触れない）のフォローの偽実装。 */
export class InMemoryFollowStore implements FollowRepository {
  readonly follows: Follow[] = [];
  private readonly users = new Set<string>();

  addUser(id: string) {
    this.users.add(id);
  }

  removeUser(id: string) {
    this.users.delete(id);
  }

  async set({ actorId, targetId, active, id, now }: Parameters<FollowRepository['set']>[0]) {
    if (!this.users.has(actorId)) return { status: 'actor-not-found' as const };
    if (!this.users.has(targetId)) return { status: 'target-not-found' as const };
    const index = this.follows.findIndex((f) => f.followerId === actorId && f.followId === targetId);
    if (!active && index >= 0) this.follows.splice(index, 1);
    if (active && index < 0) this.follows.push({ id, followerId: actorId, followId: targetId, createdAt: now });
    return { status: 'set' as const, active };
  }
}
