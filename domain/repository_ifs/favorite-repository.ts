/** お気に入りの保存。登録・解除はどちらも冪等（保存済みの登録は日時を変えず、解除済みの解除も成功）。 */
export interface FavoriteRepository {
  set(input: {
    actorId: string;
    tweetId: string;
    /** trueで登録、falseで解除。トグルにはしない。 */
    active: boolean;
    /** 新しく登録するときのお気に入りUUID。 */
    id: string;
    now: Date;
  }): Promise<{ status: 'set'; active: boolean } | { status: 'actor-not-found' | 'tweet-not-found' }>;
}
