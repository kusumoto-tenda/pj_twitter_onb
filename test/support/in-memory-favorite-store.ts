import type { FavoritePage } from '@/application/favorites/favorite';
import type { FavoriteQuery } from '@/application/favorites/ports/favorite-query';
import type { FavoriteRepository } from '@/application/favorites/ports/favorite-repository';

type Favorite = { id: string; userId: string; tweetId: string; createdAt: Date };

/** 実DBと同じ規則（利用者・投稿ごとに1行、冪等な登録・解除）のお気に入りの偽実装。 */
export class InMemoryFavoriteStore implements FavoriteRepository, FavoriteQuery {
  readonly favorites: Favorite[] = [];
  private readonly users = new Set<string>();
  private readonly tweets = new Map<string, string>();
  page: FavoritePage = { items: [], nextCursor: null };

  addUser(id: string) {
    this.users.add(id);
  }

  removeUser(id: string) {
    this.users.delete(id);
    this.favorites.splice(0, this.favorites.length, ...this.favorites.filter((f) => f.userId !== id));
  }

  addTweet(id: string, ownerId: string) {
    this.tweets.set(id, ownerId);
  }

  forUser(userId: string) {
    return this.favorites.filter((f) => f.userId === userId);
  }

  async set({ actorId, tweetId, active, id, now }: Parameters<FavoriteRepository['set']>[0]) {
    if (!this.users.has(actorId)) return { status: 'actor-not-found' as const };
    const index = this.favorites.findIndex((f) => f.userId === actorId && f.tweetId === tweetId);
    if (!active) {
      if (index >= 0) this.favorites.splice(index, 1);
      return { status: 'set' as const, active };
    }
    if (!this.tweets.has(tweetId)) return { status: 'tweet-not-found' as const };
    if (index < 0) this.favorites.push({ id, userId: actorId, tweetId, createdAt: now });
    return { status: 'set' as const, active };
  }

  async findPage(_input: Parameters<FavoriteQuery['findPage']>[0]): Promise<FavoritePage> {
    return this.page;
  }
}
