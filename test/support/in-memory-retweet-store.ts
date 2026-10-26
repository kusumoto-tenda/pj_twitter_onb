import type { RetweetRepository } from '@/application/retweets/ports/retweet-repository';

type Retweet = { id: string; executorId: string; tweetId: string; createdAt: Date };

/** 実DBと同じ規則（利用者・投稿ごとに1行、冪等な登録・解除、件数の読み返し）のリツイートの偽実装。 */
export class InMemoryRetweetStore implements RetweetRepository {
  readonly retweets: Retweet[] = [];
  private readonly users = new Set<string>();
  private readonly tweets = new Map<string, string>();

  addUser(id: string) {
    this.users.add(id);
  }

  addTweet(id: string, ownerId: string) {
    this.tweets.set(id, ownerId);
  }

  forTweet(tweetId: string) {
    return this.retweets.filter((retweet) => retweet.tweetId === tweetId);
  }

  async set({ actorId, tweetId, active, id, now }: Parameters<RetweetRepository['set']>[0]) {
    if (!this.users.has(actorId)) return { status: 'actor-not-found' as const };
    if (!this.tweets.has(tweetId)) return { status: 'tweet-not-found' as const };
    const index = this.retweets.findIndex((r) => r.executorId === actorId && r.tweetId === tweetId);
    if (!active && index >= 0) this.retweets.splice(index, 1);
    if (active && index < 0) this.retweets.push({ id, executorId: actorId, tweetId, createdAt: now });
    return { status: 'set' as const, active, count: this.forTweet(tweetId).length };
  }
}
