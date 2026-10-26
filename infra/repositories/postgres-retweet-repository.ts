import type postgres from 'postgres';
import type { RetweetRepository } from '@/application/retweets/ports/retweet-repository';

type SetOutcome = Awaited<ReturnType<RetweetRepository['set']>>;

const FK_OUTCOMES: Record<string, SetOutcome> = {
  retweets_executor_id_fkey: { status: 'actor-not-found' },
  retweets_tweet_id_fkey: { status: 'tweet-not-found' },
};

export class PostgresRetweetRepository implements RetweetRepository {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * 利用者を FOR KEY SHARE、元投稿を FOR NO KEY UPDATE でロックして実在を確かめてから登録（重複は何もしない）・
   * 解除し、最後に件数を読み返す。投稿のロックで同じ元投稿への操作・投稿の削除と直列化するので、返す件数が
   * 操作の結果と一致し、削除済みの投稿へ行を残さない。投稿の本文・日時・版は更新しない。
   */
  async set({ actorId, tweetId, active, id, now }: Parameters<RetweetRepository['set']>[0]): Promise<SetOutcome> {
    try {
      return await this.sql.begin(async (tx): Promise<SetOutcome> => {
        // いいね・お気に入りと同じく利用者→投稿の順でロックし、退会・投稿の削除とのデッドロックを避ける。
        const [actor] = await tx`SELECT 1 FROM twitter.users WHERE id = ${actorId} FOR KEY SHARE`;
        if (!actor) return { status: 'actor-not-found' };
        const [tweet] = await tx`SELECT 1 FROM twitter.tweets WHERE id = ${tweetId} FOR NO KEY UPDATE`;
        if (!tweet) return { status: 'tweet-not-found' };
        if (active) {
          // 登録済みならUUID・日時を変えない（タイムラインの順位も上がらない）。
          await tx`
            INSERT INTO twitter.retweets (id, executor_id, tweet_id, created_at)
            VALUES (${id}, ${actorId}, ${tweetId}, ${now})
            ON CONFLICT (executor_id, tweet_id) DO NOTHING
          `;
        } else {
          // 解除済みの解除も成功にする。他人のリツイートには触れない。
          await tx`DELETE FROM twitter.retweets WHERE executor_id = ${actorId} AND tweet_id = ${tweetId}`;
        }
        const [{ count }] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM twitter.retweets WHERE tweet_id = ${tweetId}
        `;
        return { status: 'set', active, count: Number(count) };
      });
    } catch (error) {
      // 競合中に関連が消えた場合の外部キー違反だけを結果に変える。それ以外のDBエラーは成功扱いしない。
      const fk = error as { code?: string; constraint_name?: string };
      if (fk.code === '23503' && fk.constraint_name && FK_OUTCOMES[fk.constraint_name]) return FK_OUTCOMES[fk.constraint_name];
      throw error;
    }
  }
}
