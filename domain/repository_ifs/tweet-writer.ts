import type { ValidTweetInput } from '@/domain/value_objects/tweets/tweet-validation';

export type PublishOutcome =
  | { status: 'published'; tweetId: string; replayed: boolean }
  | { status: 'draft-not-found' | 'forbidden' | 'draft-closed' | 'upload-not-ready' | 'conflict' };

/** 下書きと投稿の確定。確定はトランザクション内で下書き・画像の状態と所有者を再確認する。 */
export interface TweetWriter {
  createDraft(input: { id: string; ownerId: string; expiresAt: Date; now: Date }): Promise<void>;
  /**
   * 下書き→画像の順にロックして確定する。draftIdを投稿UUIDとして使う。
   * 確定済みの同じ下書きへの同じ内容（fingerprint）の再送は既存の投稿を返す。
   */
  publish(input: {
    actorId: string;
    draftId: string;
    value: ValidTweetInput;
    fingerprint: string;
    now: Date;
  }): Promise<PublishOutcome>;
  /** 未投稿の下書きを破棄し、その画像の削除を予約する。 */
  discardDraft(input: {
    actorId: string;
    draftId: string;
    now: Date;
  }): Promise<'discarded' | 'not-found' | 'forbidden' | 'published'>;
}
