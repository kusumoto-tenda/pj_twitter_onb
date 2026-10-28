import type {
  MediaRepository,
  OwnedUpload,
  ReserveUploadOutcome,
} from '@/application/media/ports/media-repository';
import { uploadPathname } from '@/application/media/media';
import type { UploadStatus, VerifiedImage } from '@/application/media/media';
import type { PublishOutcome, TweetWriter } from '@/application/tweets/ports/tweet-writer';
import { MAX_IMAGES_PER_TWEET, type ValidTweetInput } from '@/domain/tweets/tweet-validation';

type Draft = {
  id: string;
  /** 編集用の下書きは 'edit'（作成用の確定では受け付けない）。 */
  purpose?: 'create' | 'edit';
  ownerId: string | null;
  status: 'open' | 'published' | 'discarded';
  expiresAt: Date;
  fingerprint: string | null;
  publishedTweetId: string | null;
};
type Upload = OwnedUpload & {
  ownerId: string | null;
  tokenValidUntil: Date;
  image: VerifiedImage | null;
};
type Tweet = { id: string; ownerId: string; content: string; createdAt: Date; updatedAt: Date };
type Image = { id: string; tweetId: string; uploadId: string; storageKey: string; position: number } & VerifiedImage;
type DeleteJob = { storageKey: string; notBefore: Date; attempts: number; nextAttemptAt: Date; lastErrorCode: string | null };

/** 下書き・画像・投稿・削除予約を1つにまとめた、実DBと同じ状態遷移のテスト用ストア。 */
export class InMemoryTweetStore implements TweetWriter, MediaRepository {
  readonly drafts = new Map<string, Draft>();
  readonly uploads = new Map<string, Upload>();
  readonly tweets = new Map<string, Tweet>();
  readonly images: Image[] = [];
  readonly deleteJobs = new Map<string, DeleteJob>();
  private imageSeq = 0;

  // ---- TweetWriter ----
  async createDraft({ id, ownerId, expiresAt }: { id: string; ownerId: string; expiresAt: Date; now: Date }) {
    this.drafts.set(id, { id, ownerId, status: 'open', expiresAt, fingerprint: null, publishedTweetId: null });
  }

  async publish({
    actorId,
    draftId,
    value,
    fingerprint,
    now,
  }: {
    actorId: string;
    draftId: string;
    value: ValidTweetInput;
    fingerprint: string;
    now: Date;
  }): Promise<PublishOutcome> {
    const draft = this.drafts.get(draftId);
    if (!draft || draft.purpose === 'edit') return { status: 'draft-not-found' };
    if (draft.ownerId !== actorId) return { status: 'forbidden' };
    if (draft.status === 'published') {
      return draft.fingerprint === fingerprint
        ? { status: 'published', tweetId: draft.publishedTweetId!, replayed: true }
        : { status: 'conflict' };
    }
    if (draft.status !== 'open' || draft.expiresAt <= now) return { status: 'draft-closed' };
    const uploads = value.uploadIds.map((id) => this.uploads.get(id));
    if (
      uploads.some(
        (u) => !u || u.draftId !== draftId || u.ownerId !== actorId || u.status !== 'verified' || !u.image,
      )
    ) {
      return { status: 'upload-not-ready' };
    }
    this.tweets.set(draftId, { id: draftId, ownerId: actorId, content: value.content, createdAt: now, updatedAt: now });
    uploads.forEach((u, position) => {
      u!.status = 'attached';
      this.images.push({
        id: this.nextImageId(),
        tweetId: draftId,
        uploadId: u!.id,
        storageKey: u!.storageKey,
        position,
        ...u!.image!,
      });
    });
    // 投稿に使わなかった予約・検証済みの画像は破棄して削除を予約する（実DBと同じ）。
    for (const upload of this.uploads.values()) {
      if (upload.draftId === draftId && (upload.status === 'reserved' || upload.status === 'verified')) {
        this.discard(upload, now);
      }
    }
    Object.assign(draft, { status: 'published', fingerprint, publishedTweetId: draftId });
    return { status: 'published', tweetId: draftId, replayed: false };
  }

  async discardDraft({ actorId, draftId, now }: { actorId: string; draftId: string; now: Date }) {
    const draft = this.drafts.get(draftId);
    if (!draft) return 'not-found' as const;
    if (draft.ownerId !== actorId) return 'forbidden' as const;
    if (draft.status === 'published') return 'published' as const;
    this.closeDraft(draft, now);
    return 'discarded' as const;
  }

  // ---- MediaRepository ----
  async reserveUpload(input: {
    actorId: string;
    draftId: string;
    uploadId: string;
    storageKey: string;
    tokenValidUntil: Date;
    now: Date;
  }): Promise<ReserveUploadOutcome> {
    const draft = this.drafts.get(input.draftId);
    if (!draft) return 'draft-not-found';
    if (draft.ownerId !== input.actorId) return 'forbidden';
    if (draft.status !== 'open' || draft.expiresAt <= input.now) return 'draft-closed';
    const existing = this.uploads.get(input.uploadId);
    if (existing) {
      if (existing.ownerId !== input.actorId) return 'forbidden';
      if (existing.draftId !== input.draftId || existing.status !== 'reserved') return 'conflict';
      if (existing.tokenValidUntil < input.tokenValidUntil) existing.tokenValidUntil = input.tokenValidUntil;
      return 'reserved';
    }
    const active = [...this.uploads.values()].filter(
      (u) => u.draftId === input.draftId && (u.status === 'reserved' || u.status === 'verified'),
    );
    if (active.length >= MAX_IMAGES_PER_TWEET) return 'limit-reached';
    this.uploads.set(input.uploadId, {
      id: input.uploadId,
      draftId: input.draftId,
      storageKey: input.storageKey,
      status: 'reserved',
      ownerId: input.actorId,
      tokenValidUntil: input.tokenValidUntil,
      image: null,
    });
    return 'reserved';
  }

  async findOwnedUpload({ actorId, uploadId, now }: { actorId: string; uploadId: string; now: Date }) {
    const upload = this.uploads.get(uploadId);
    if (!upload) return { status: 'not-found' as const };
    if (upload.ownerId !== actorId) return { status: 'forbidden' as const };
    const draft = this.drafts.get(upload.draftId)!;
    if (draft.status !== 'open' || draft.expiresAt <= now) return { status: 'draft-closed' as const };
    const { id, draftId, storageKey, status } = upload;
    return { status: 'found' as const, upload: { id, draftId, storageKey, status } };
  }

  async markVerified({ actorId, uploadId, image }: { actorId: string; uploadId: string; image: VerifiedImage; now: Date }) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.ownerId !== actorId || upload.status !== 'reserved') return 'not-reservable' as const;
    upload.status = 'verified';
    upload.image = image;
    return 'verified' as const;
  }

  async discardUpload({ actorId, uploadId, draftId, now }: { actorId: string; uploadId: string; draftId?: string; now: Date }) {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      const draft = draftId === undefined ? undefined : this.drafts.get(draftId);
      if (!draft) return 'not-found' as const;
      if (draft.ownerId !== actorId) return 'forbidden' as const;
      if (draft.status !== 'open' || draft.expiresAt <= now) return 'not-found' as const;
      const storageKey = uploadPathname(draft.id, uploadId);
      this.uploads.set(uploadId, {
        id: uploadId,
        draftId: draft.id,
        storageKey,
        status: 'discarded',
        ownerId: actorId,
        tokenValidUntil: now,
        image: null,
      });
      if (!this.deleteJobs.has(storageKey)) {
        this.deleteJobs.set(storageKey, {
          storageKey,
          notBefore: draft.expiresAt,
          attempts: 0,
          nextAttemptAt: draft.expiresAt,
          lastErrorCode: null,
        });
      }
      return 'discarded' as const;
    }
    if (upload.ownerId !== actorId) return 'forbidden' as const;
    if (upload.status === 'attached') return 'attached' as const;
    if (upload.status === 'reserved' || upload.status === 'verified') this.discard(upload, now);
    return 'discarded' as const;
  }

  async discardExpiredDrafts({ now, limit }: { now: Date; limit: number }) {
    const expired = [...this.drafts.values()]
      .filter((d) => d.status === 'open' && d.expiresAt <= now)
      .slice(0, limit);
    for (const draft of expired) this.closeDraft(draft, now);
    return expired.length;
  }

  async claimDueDeleteJobs({ now, limit }: { now: Date; limit: number }) {
    return [...this.deleteJobs.values()]
      .filter((j) => j.notBefore <= now && j.nextAttemptAt <= now)
      .slice(0, limit)
      .map((j) => j.storageKey);
  }

  async completeDeleteJob(storageKey: string) {
    this.deleteJobs.delete(storageKey);
    for (const upload of this.uploads.values()) {
      if (upload.storageKey === storageKey && upload.status !== 'attached') this.uploads.delete(upload.id);
    }
  }

  async failDeleteJob(storageKey: string, { errorCode, nextAttemptAt }: { errorCode: string; nextAttemptAt: Date }) {
    const job = this.deleteJobs.get(storageKey);
    if (job) Object.assign(job, { attempts: job.attempts + 1, nextAttemptAt, lastErrorCode: errorCode });
  }

  async findKeptStorageKeys(storageKeys: string[]) {
    const kept = new Set<string>();
    for (const key of storageKeys) {
      if (this.images.some((i) => i.storageKey === key)) kept.add(key);
      for (const u of this.uploads.values()) {
        if (u.storageKey === key && (['reserved', 'verified', 'attached'] as UploadStatus[]).includes(u.status)) kept.add(key);
      }
    }
    return kept;
  }

  async findPublishedImage(imageId: string) {
    const image = this.images.find((i) => i.id === imageId);
    if (!image || !this.tweets.has(image.tweetId)) return null;
    return { storageKey: image.storageKey, contentType: image.contentType, size: image.size };
  }

  // ---- テスト補助 ----
  /** 実DBと同じくUUID形式の画像IDを振る。 */
  nextImageId() {
    return `00000000-0000-4000-9000-${String(++this.imageSeq).padStart(12, '0')}`;
  }

  /** 利用者削除のCASCADE・SET NULLを再現する。 */
  deleteUser(userId: string, now = new Date()) {
    for (const tweet of [...this.tweets.values()].filter((t) => t.ownerId === userId)) {
      this.tweets.delete(tweet.id);
      for (const image of this.images.filter((i) => i.tweetId === tweet.id)) {
        this.images.splice(this.images.indexOf(image), 1);
        this.schedule(image.storageKey, now);
      }
    }
    for (const draft of this.drafts.values()) if (draft.ownerId === userId) draft.ownerId = null;
    for (const upload of this.uploads.values()) if (upload.ownerId === userId) upload.ownerId = null;
  }

  closeDraft(draft: Draft, now: Date) {
    draft.status = 'discarded';
    for (const upload of this.uploads.values()) {
      if (upload.draftId === draft.id && (upload.status === 'reserved' || upload.status === 'verified')) {
        this.discard(upload, now);
      }
    }
  }

  discard(upload: Upload, now: Date) {
    upload.status = 'discarded';
    // トークンが有効な間は遅れて届くアップロードで実体が再生成され得るため、期限後に削除する。
    this.schedule(upload.storageKey, upload.tokenValidUntil > now ? upload.tokenValidUntil : now);
  }

  schedule(storageKey: string, notBefore: Date) {
    if (!this.deleteJobs.has(storageKey)) {
      this.deleteJobs.set(storageKey, { storageKey, notBefore, attempts: 0, nextAttemptAt: notBefore, lastErrorCode: null });
    }
  }
}
