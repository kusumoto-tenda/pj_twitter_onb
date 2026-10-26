import type postgres from 'postgres';
import type { DeleteTarget, TweetDeleter } from '@/application/tweets/ports/tweet-deleter';
import { UUID_PATTERN } from './media-sql';

export class PostgresTweetDeleter implements TweetDeleter {
  constructor(private readonly sql: postgres.Sql) {}

  async findTarget(tweetId: string): Promise<DeleteTarget | null> {
    if (!UUID_PATTERN.test(tweetId)) return null;
    const [row] = await this.sql<{ owner_id: string; content: string }[]>`
      SELECT owner_id, content FROM twitter.tweets WHERE id = ${tweetId}
    `;
    return row ? { tweetId, ownerId: row.owner_id, content: row.content } : null;
  }

  /**
   * 本人の投稿だけを削除する。画像・リツイートはCASCADE、画像の実体の削除予約はトリガーで、同じトランザクション内に作る。
   * Blobはここでは消さない（配信は画像行がなくなった時点で404になり、実体は期限以降の回収で消える）。
   */
  async deleteOwned({ actorId, tweetId }: { actorId: string; tweetId: string }): Promise<'deleted' | 'not-found' | 'forbidden'> {
    if (!UUID_PATTERN.test(tweetId)) return 'not-found';
    // 遅延制約・トリガーの失敗を受け取るため、明示的なトランザクションで実行する。
    return this.sql.begin(async (tx) => {
      // 編集の確定（下書き→投稿の順にロック）と同じ順にするため、この投稿を参照する下書きを先にロックする。
      // 削除時の ON DELETE SET NULL で下書きを更新するので、逆順だとデッドロックになり得る。
      await tx`
        SELECT id FROM twitter.tweet_drafts
        WHERE target_tweet_id = ${tweetId} OR published_tweet_id = ${tweetId}
        ORDER BY id FOR UPDATE
      `;
      const [tweet] = await tx<{ owner_id: string }[]>`
        SELECT owner_id FROM twitter.tweets WHERE id = ${tweetId} FOR UPDATE
      `;
      // 同時に削除された場合も、ロック後の状態で決める。
      if (!tweet) return 'not-found' as const;
      if (tweet.owner_id !== actorId) return 'forbidden' as const;
      await tx`DELETE FROM twitter.tweets WHERE id = ${tweetId} AND owner_id = ${actorId}`;
      return 'deleted' as const;
    });
  }
}
