/**
 * いいねの保存。登録・解除はどちらも冪等（登録済みの登録はUUID・日時を変えず、解除済みの解除も成功）。
 * 成功時は操作後の元投稿の公開いいね件数を返す。
 */
export interface LikeRepository {
  set(input: {
    actorId: string;
    tweetId: string;
    /** trueで登録、falseで解除。トグルにはしない。 */
    active: boolean;
    /** 新しく登録するときのいいねUUID。 */
    id: string;
    now: Date;
  }): Promise<{ status: 'set'; active: boolean; count: number } | { status: 'actor-not-found' | 'tweet-not-found' }>;
}
