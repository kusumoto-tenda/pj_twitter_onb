import type { ValidEditTweetInput } from '@/domain/tweets/edit-tweet-validation';

/** 編集ダイアログの初期値。DBの現在の内容から作る（カードの古い内容は使わない）。 */
export type EditableTweet = {
  draftId: string;
  tweetId: string;
  content: string;
  images: { id: string; position: number; width: number; height: number }[];
};

export type PrepareEditOutcome =
  | { status: 'ready'; value: EditableTweet }
  | { status: 'not-found' | 'forbidden' };

export type CommitEditOutcome =
  | { status: 'updated'; tweetId: string; replayed: boolean }
  | {
      status: 'not-found' | 'forbidden' | 'draft-closed' | 'conflict' | 'invalid-images' | 'upload-not-ready';
    };

/** 投稿の編集。準備時の版（revision）を下書きに記録し、確定時に比べて競合を検出する。 */
export interface TweetEditor {
  prepare(input: {
    actorId: string;
    tweetId: string;
    draftId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<PrepareEditOutcome>;
  /** 下書き→対象投稿→画像の順にロックし、本文・画像の更新と削除予約を1つのトランザクションで行う。 */
  commit(input: {
    actorId: string;
    draftId: string;
    value: ValidEditTweetInput;
    fingerprint: string;
    now: Date;
  }): Promise<CommitEditOutcome>;
}
