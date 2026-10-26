import type { LikeRepository } from '@/application/likes/ports/like-repository';

type Like = { id: string; executorId: string; tweetId: string; createdAt: Date };

/** 実DBと同じ規則（利用者・投稿ごとに1行、冪等な登録・解除、件数の読み返し）のいいねの偽実装。 */
export class InMemoryLikeStore implements LikeRepository {
  readonly likes: Like[] = [];
  private readonly users = new Set<string>();
  private readonly tweets = new Map<string, string>();

  addUser(id: string) {
    this.users.add(id);
  }

  removeUser(id: string) {
    this.users.delete(id);
    this.likes.splice(0, this.likes.length, ...this.likes.filter((like) => like.executorId !== id));
  }

  addTweet(id: string, ownerId: string) {
    this.tweets.set(id, ownerId);
  }

  forTweet(tweetId: string) {
    return this.likes.filter((like) => like.tweetId === tweetId);
  }

  async set({ actorId, tweetId, active, id, now }: Parameters<LikeRepository['set']>[0]) {
    if (!this.users.has(actorId)) return { status: 'actor-not-found' as const };
    if (!this.tweets.has(tweetId)) return { status: 'tweet-not-found' as const };
    const index = this.likes.findIndex((like) => like.executorId === actorId && like.tweetId === tweetId);
    if (!active && index >= 0) this.likes.splice(index, 1);
    if (active && index < 0) this.likes.push({ id, executorId: actorId, tweetId, createdAt: now });
    return { status: 'set' as const, active, count: this.forTweet(tweetId).length };
  }
}
