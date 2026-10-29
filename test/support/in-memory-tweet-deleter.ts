import type { DeleteTarget, TweetDeleter } from '@/domain/repository_ifs/tweet-deleter';
import type { InMemoryTweetStore } from './in-memory-tweet-writer';

/** 作成用のテストストアと状態を共有する、実DBと同じ規則の削除の偽実装。 */
export class InMemoryTweetDeleter implements TweetDeleter {
  readonly deleted: string[] = [];

  constructor(private readonly store: InMemoryTweetStore) {}

  async findTarget(tweetId: string): Promise<DeleteTarget | null> {
    const tweet = this.store.tweets.get(tweetId);
    return tweet ? { tweetId, ownerId: tweet.ownerId, content: tweet.content } : null;
  }

  async deleteOwned({ actorId, tweetId }: { actorId: string; tweetId: string }) {
    const tweet = this.store.tweets.get(tweetId);
    if (!tweet) return 'not-found' as const;
    if (tweet.ownerId !== actorId) return 'forbidden' as const;
    this.store.tweets.delete(tweetId);
    // 画像行の削除と同時に実体の削除を予約する（DBのCASCADEとトリガーに相当）。
    for (let i = this.store.images.length - 1; i >= 0; i -= 1) {
      const image = this.store.images[i];
      if (image.tweetId !== tweetId) continue;
      this.store.images.splice(i, 1);
      const upload = this.store.uploads.get(image.uploadId);
      if (upload) upload.status = 'deleting';
      const notBefore = upload?.tokenValidUntil ?? new Date();
      this.store.deleteJobs.set(image.storageKey, {
        storageKey: image.storageKey,
        notBefore,
        attempts: 0,
        nextAttemptAt: notBefore,
        lastErrorCode: null,
      });
    }
    this.deleted.push(tweetId);
    return 'deleted' as const;
  }
}
