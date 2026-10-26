import type postgres from 'postgres';
import type { PublishOutcome, TweetWriter } from '@/application/tweets/ports/tweet-writer';
import type { ValidTweetInput } from '@/domain/tweets/tweet-validation';
import { UUID_PATTERN, discardOpenUploads } from './media-sql';

type DraftRow = {
  owner_id: string | null;
  status: 'open' | 'published' | 'discarded';
  expires_at: Date;
  fingerprint: string | null;
  published_tweet_id: string | null;
};

type UploadRow = {
  id: string;
  draft_id: string;
  owner_id: string | null;
  status: string;
  storage_key: string;
  size_bytes: number | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
};

export class PostgresTweetWriter implements TweetWriter {
  constructor(private readonly sql: postgres.Sql) {}

  async createDraft({ id, ownerId, expiresAt, now }: { id: string; ownerId: string; expiresAt: Date; now: Date }) {
    await this.sql`
      INSERT INTO twitter.tweet_drafts (id, owner_id, status, expires_at, created_at)
      VALUES (${id}, ${ownerId}, 'open', ${expiresAt}, ${now})
    `;
  }

  /** 下書き→画像の順にロックし、所有者・期限・画像の状態を再確認して、投稿と画像を1つのトランザクションで保存する。 */
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
    if (!UUID_PATTERN.test(draftId)) return { status: 'draft-not-found' };
    return this.sql.begin(async (tx): Promise<PublishOutcome> => {
      const [draft] = await tx<DraftRow[]>`
        SELECT owner_id, status, expires_at, fingerprint, published_tweet_id
        FROM twitter.tweet_drafts WHERE id = ${draftId} FOR UPDATE
      `;
      if (!draft) return { status: 'draft-not-found' };
      if (draft.owner_id !== actorId) return { status: 'forbidden' };
      if (draft.status === 'published') {
        return draft.fingerprint === fingerprint && draft.published_tweet_id
          ? { status: 'published', tweetId: draft.published_tweet_id, replayed: true }
          : { status: 'conflict' };
      }
      if (draft.status !== 'open' || draft.expires_at <= now) return { status: 'draft-closed' };

      const ids = value.uploadIds;
      const uploads =
        ids.length === 0
          ? []
          : await tx<UploadRow[]>`
              SELECT id, draft_id, owner_id, status, storage_key, size_bytes, content_type, width, height
              FROM twitter.media_uploads WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE
            `;
      const byId = new Map(uploads.map((u) => [u.id.toLowerCase(), u]));
      const ordered = ids.map((id) => byId.get(id.toLowerCase()));
      if (
        ordered.some(
          (u) => !u || u.draft_id !== draftId || u.owner_id !== actorId || u.status !== 'verified',
        )
      ) {
        return { status: 'upload-not-ready' };
      }

      await tx`
        INSERT INTO twitter.tweets (id, owner_id, content, created_at, updated_at)
        VALUES (${draftId}, ${actorId}, ${value.content}, ${now}, ${now})
      `;
      for (const [position, upload] of ordered.entries()) {
        await tx`
          INSERT INTO twitter.images
            (id, tweet_id, upload_id, storage_key, position, size_bytes, content_type, width, height)
          VALUES (
            gen_random_uuid(), ${draftId}, ${upload!.id}, ${upload!.storage_key}, ${position},
            ${upload!.size_bytes}, ${upload!.content_type}, ${upload!.width}, ${upload!.height}
          )
        `;
      }
      if (ids.length > 0) {
        await tx`UPDATE twitter.media_uploads SET status = 'attached' WHERE id = ANY(${ids}::uuid[])`;
      }
      await tx`
        UPDATE twitter.tweet_drafts
        SET status = 'published', fingerprint = ${fingerprint}, published_tweet_id = ${draftId}
        WHERE id = ${draftId}
      `;
      return { status: 'published', tweetId: draftId, replayed: false };
    });
  }

  async discardDraft({ actorId, draftId, now }: { actorId: string; draftId: string; now: Date }) {
    if (!UUID_PATTERN.test(draftId)) return 'not-found' as const;
    return this.sql.begin(async (tx) => {
      const [draft] = await tx<DraftRow[]>`
        SELECT owner_id, status FROM twitter.tweet_drafts WHERE id = ${draftId} FOR UPDATE
      `;
      if (!draft) return 'not-found' as const;
      if (draft.owner_id !== actorId) return 'forbidden' as const;
      if (draft.status === 'published') return 'published' as const;
      await tx`UPDATE twitter.tweet_drafts SET status = 'discarded' WHERE id = ${draftId}`;
      await discardOpenUploads(tx, { draftIds: [draftId], now });
      return 'discarded' as const;
    });
  }
}
