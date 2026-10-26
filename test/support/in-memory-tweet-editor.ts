import type {
  CommitEditOutcome,
  PrepareEditOutcome,
  TweetEditor,
} from '@/application/tweets/ports/tweet-editor';
import type { ValidEditTweetInput } from '@/domain/tweets/edit-tweet-validation';
import type { InMemoryTweetStore } from './in-memory-tweet-writer';

type EditMeta = { targetTweetId: string; baseRevision: number };

/** 作成用のテストストアと状態を共有する、実DBと同じ規則の編集の偽実装。 */
export class InMemoryTweetEditor implements TweetEditor {
  readonly revisions = new Map<string, number>();
  readonly edits = new Map<string, EditMeta>();

  constructor(private readonly store: InMemoryTweetStore) {}

  revision(tweetId: string) {
    return this.revisions.get(tweetId) ?? 0;
  }

  async prepare({ actorId, tweetId, draftId, expiresAt }: Parameters<TweetEditor['prepare']>[0]): Promise<PrepareEditOutcome> {
    const tweet = this.store.tweets.get(tweetId);
    if (!tweet) return { status: 'not-found' };
    if (tweet.ownerId !== actorId) return { status: 'forbidden' };
    this.store.drafts.set(draftId, {
      id: draftId,
      purpose: 'edit',
      ownerId: actorId,
      status: 'open',
      expiresAt,
      fingerprint: null,
      publishedTweetId: null,
    });
    this.edits.set(draftId, { targetTweetId: tweetId, baseRevision: this.revision(tweetId) });
    return {
      status: 'ready',
      value: {
        draftId,
        tweetId,
        content: tweet.content,
        images: this.imagesOf(tweetId).map(({ id, position, width, height }) => ({ id, position, width, height })),
      },
    };
  }

  async commit({ actorId, draftId, value, fingerprint, now }: Parameters<TweetEditor['commit']>[0]): Promise<CommitEditOutcome> {
    const draft = this.store.drafts.get(draftId);
    const meta = this.edits.get(draftId);
    if (!draft || !meta) return { status: 'not-found' };
    if (draft.ownerId !== actorId) return { status: 'forbidden' };
    const tweet = this.store.tweets.get(meta.targetTweetId);
    if (!tweet) return { status: 'not-found' };
    if (tweet.ownerId !== actorId) return { status: 'forbidden' };
    if (draft.status === 'published') {
      return draft.fingerprint === fingerprint
        ? { status: 'updated', tweetId: tweet.id, replayed: true }
        : { status: 'conflict' };
    }
    if (draft.status !== 'open' || draft.expiresAt <= now) return { status: 'draft-closed' };
    if (this.revision(tweet.id) !== meta.baseRevision) return { status: 'conflict' };

    const current = this.imagesOf(tweet.id);
    if (!keepsRelativeOrder(current.map((i) => i.id), value.keepImageIds)) return { status: 'invalid-images' };
    const uploads = value.uploadIds.map((id) => this.store.uploads.get(id));
    if (uploads.some((u) => !u || u.draftId !== draftId || u.ownerId !== actorId || u.status !== 'verified' || !u.image)) {
      return { status: 'upload-not-ready' };
    }

    const changed = tweet.content !== value.content || !sameImages(current.map((i) => i.id), value);
    for (const image of current.filter((i) => !value.keepImageIds.includes(i.id))) {
      this.store.images.splice(this.store.images.indexOf(image), 1);
      this.store.schedule(image.storageKey, now);
    }
    value.keepImageIds.forEach((id, position) => {
      this.store.images.find((i) => i.id === id)!.position = position;
    });
    uploads.forEach((u, index) => {
      u!.status = 'attached';
      this.store.images.push({
        id: this.store.nextImageId(),
        tweetId: tweet.id,
        uploadId: u!.id,
        storageKey: u!.storageKey,
        position: value.keepImageIds.length + index,
        ...u!.image!,
      });
    });
    if (changed) {
      tweet.content = value.content;
      tweet.updatedAt = now;
      this.revisions.set(tweet.id, this.revision(tweet.id) + 1);
    }
    for (const upload of this.store.uploads.values()) {
      if (upload.draftId === draftId && (upload.status === 'reserved' || upload.status === 'verified')) {
        this.store.discard(upload, now);
      }
    }
    Object.assign(draft, { status: 'published', fingerprint, publishedTweetId: tweet.id });
    return { status: 'updated', tweetId: tweet.id, replayed: false };
  }

  private imagesOf(tweetId: string) {
    return this.store.images.filter((i) => i.tweetId === tweetId).sort((a, b) => a.position - b.position);
  }
}

/** keepが現在の画像の部分列（元の相対順のまま）か。 */
function keepsRelativeOrder(current: string[], keep: string[]): boolean {
  let index = 0;
  for (const id of current) if (id === keep[index]) index += 1;
  return index === keep.length;
}

function sameImages(current: string[], value: ValidEditTweetInput): boolean {
  return value.uploadIds.length === 0 && current.length === value.keepImageIds.length;
}
