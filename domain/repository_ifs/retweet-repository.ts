/**
 * 元投稿へのリツイートを登録・解除する。登録済みへの登録はUUID・日時を維持し、解除済みへの解除も成功する。
 * 自己投稿も許可し、解除するのはactorIdとtweetIdの組だけ。成功時は操作後の状態と公開件数を返す。
 */
export interface RetweetRepository {
  set(input: {
    actorId: string;
    tweetId: string;
    /** trueで登録、falseで解除。トグルにはしない。 */
    active: boolean;
    /** 新しく登録するときに使う、サーバー生成のリツイートUUID。 */
    id: string;
    now: Date;
  }): Promise<{ status: 'set'; active: boolean; count: number } | { status: 'actor-not-found' | 'tweet-not-found' }>;
}
