import type postgres from 'postgres';
import type { FavoriteRepository } from '@/application/favorites/ports/favorite-repository';

type SetOutcome = Awaited<ReturnType<FavoriteRepository['set']>>;

const FK_OUTCOMES: Record<string, SetOutcome> = {
  favorites_user_id_fkey: { status: 'actor-not-found' },
  favorites_tweet_id_fkey: { status: 'tweet-not-found' },
};

export class PostgresFavoriteRepository implements FavoriteRepository {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * 利用者・投稿を FOR KEY SHARE でロックして実在を確かめてから、登録（重複は何もしない）・解除する。
   * ロックで退会・投稿の削除と直列化するので、削除済みの投稿へ行を残さない。
   */
  async set({ actorId, tweetId, active, id, now }: Parameters<FavoriteRepository['set']>[0]): Promise<SetOutcome> {
    try {
      return await this.sql.begin(async (tx): Promise<SetOutcome> => {
        const [actor] = await tx`SELECT 1 FROM twitter.users WHERE id = ${actorId} FOR KEY SHARE`;
        if (!actor) return { status: 'actor-not-found' };
        if (!active) {
          // 解除済み・投稿が既にない場合も、行がない状態なので成功にする。
          await tx`DELETE FROM twitter.favorites WHERE user_id = ${actorId} AND tweet_id = ${tweetId}`;
          return { status: 'set', active };
        }
        const [tweet] = await tx`SELECT 1 FROM twitter.tweets WHERE id = ${tweetId} FOR KEY SHARE`;
        if (!tweet) return { status: 'tweet-not-found' };
        // 保存済みなら保存日時・UUIDを変えない。
        await tx`
          INSERT INTO twitter.favorites (id, user_id, tweet_id, created_at)
          VALUES (${id}, ${actorId}, ${tweetId}, ${now})
          ON CONFLICT (user_id, tweet_id) DO NOTHING
        `;
        return { status: 'set', active };
      });
    } catch (error) {
      // 競合中に関連が消えた場合の外部キー違反だけを結果に変える。それ以外のDBエラーは成功扱いしない。
      const fk = error as { code?: string; constraint_name?: string };
      if (fk.code === '23503' && fk.constraint_name && FK_OUTCOMES[fk.constraint_name]) return FK_OUTCOMES[fk.constraint_name];
      throw error;
    }
  }
}
