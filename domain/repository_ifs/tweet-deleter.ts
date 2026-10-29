/** 削除確認に使う対象。DBの現在の所有者で判定する。 */
export type DeleteTarget = { tweetId: string; ownerId: string; content: string };

/** 投稿の削除。画像・リツイートはDBのCASCADEで、画像の実体は削除予約で後から消す。 */
export interface TweetDeleter {
  findTarget(tweetId: string): Promise<DeleteTarget | null>;
  /** 対象をロックしてから存在と所有者を確かめ、本人の投稿だけを1つのトランザクションで削除する。 */
  deleteOwned(input: { actorId: string; tweetId: string }): Promise<'deleted' | 'not-found' | 'forbidden'>;
}
