import type { UploadStatus, VerifiedImage } from '../media';

export type ReserveUploadOutcome =
  | 'reserved'
  | 'forbidden'
  | 'draft-not-found'
  | 'draft-closed'
  | 'limit-reached'
  /** 同じIDが別の下書き・状態で使われている。 */
  | 'conflict';

export type OwnedUpload = { id: string; draftId: string; storageKey: string; status: UploadStatus };

/** 画像の予約・検証・破棄・回収の状態を保存する。所有者・下書きの確認は保存側でもロックして行う。 */
export interface MediaRepository {
  /**
   * 下書きをロックし、所有者・有効期限・使用中の枚数（4枚まで）を確認して予約する。
   * 同じ下書きで予約中の同じIDなら、再送とみなしてトークンの期限だけ延ばし 'reserved' を返す。
   */
  reserveUpload(input: {
    actorId: string;
    draftId: string;
    uploadId: string;
    storageKey: string;
    tokenValidUntil: Date;
    now: Date;
  }): Promise<ReserveUploadOutcome>;
  findOwnedUpload(input: {
    actorId: string;
    uploadId: string;
    now: Date;
  }): Promise<{ status: 'found'; upload: OwnedUpload } | { status: 'not-found' | 'forbidden' | 'draft-closed' }>;
  /** reservedのものだけをverifiedにする（破棄済みなどは戻さない）。 */
  markVerified(input: {
    actorId: string;
    uploadId: string;
    image: VerifiedImage;
    now: Date;
  }): Promise<'verified' | 'not-reservable'>;
  /** 未投稿の画像を破棄し、トークンの期限後に実体を削除する予約を残す。 */
  discardUpload(input: {
    actorId: string;
    uploadId: string;
    now: Date;
  }): Promise<'discarded' | 'not-found' | 'forbidden' | 'attached'>;
  /** 期限切れの未投稿下書きを破棄し、その画像の削除を予約する。破棄した件数を返す。 */
  discardExpiredDrafts(input: { now: Date; limit: number }): Promise<number>;
  /** 実行時期が来た削除予約のストレージキーを取得する。 */
  claimDueDeleteJobs(input: { now: Date; limit: number }): Promise<string[]>;
  completeDeleteJob(storageKey: string): Promise<void>;
  failDeleteJob(storageKey: string, input: { errorCode: string; nextAttemptAt: Date }): Promise<void>;
  /** 公開中・有効な下書きで使用中など、削除してはいけないキーを返す。 */
  findKeptStorageKeys(storageKeys: string[]): Promise<Set<string>>;
  /** 公開済みの投稿に属する画像だけを返す。 */
  findPublishedImage(imageId: string): Promise<{
    storageKey: string;
    contentType: string;
    size: number;
  } | null>;
}
