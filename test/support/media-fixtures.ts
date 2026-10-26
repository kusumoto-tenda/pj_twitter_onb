import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { uploadPathname } from '@/application/media/media';
import type { VerifiedImage } from '@/application/media/media';
import { PostgresMediaRepository } from '@/infra/repositories/postgres-media-repository';
import { PostgresTweetWriter } from '@/infra/repositories/postgres-tweet-writer';

export const PNG_IMAGE: VerifiedImage = { size: 1234, contentType: 'image/png', width: 40, height: 30 };

/** 下書き・予約・検証済み画像を実DBに用意する。作成者の削除で後片付けできる（下書き等は別途削除）。 */
export class MediaFixtures {
  readonly writer: PostgresTweetWriter;
  readonly media: PostgresMediaRepository;
  private readonly draftIds: string[] = [];

  constructor(private readonly sql: postgres.Sql) {
    this.writer = new PostgresTweetWriter(sql);
    this.media = new PostgresMediaRepository(sql);
  }

  async draft(ownerId: string, now = new Date(), ttlMs = 24 * 3600_000): Promise<string> {
    const id = randomUUID();
    this.draftIds.push(id);
    await this.writer.createDraft({ id, ownerId, expiresAt: new Date(now.getTime() + ttlMs), now });
    return id;
  }

  async reserved(ownerId: string, draftId: string, now = new Date(), tokenTtlMs = 15 * 60_000) {
    const uploadId = randomUUID();
    const storageKey = uploadPathname(draftId, uploadId);
    const outcome = await this.media.reserveUpload({
      actorId: ownerId,
      draftId,
      uploadId,
      storageKey,
      tokenValidUntil: new Date(now.getTime() + tokenTtlMs),
      now,
    });
    return { uploadId, storageKey, outcome };
  }

  async verified(ownerId: string, draftId: string, now = new Date(), image = PNG_IMAGE) {
    const upload = await this.reserved(ownerId, draftId, now);
    await this.media.markVerified({ actorId: ownerId, uploadId: upload.uploadId, image, now });
    return upload;
  }

  /** 作成した下書きと、それに属する予約・削除予約を消す（利用者の削除では残るため）。 */
  async cleanup() {
    const ids = this.draftIds.splice(0);
    if (ids.length === 0) return;
    await this.sql`
      DELETE FROM twitter.media_delete_jobs WHERE storage_key IN (
        SELECT storage_key FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[])
      )
    `;
    await this.sql`DELETE FROM twitter.images WHERE upload_id IN (
      SELECT id FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[])
    )`;
    await this.sql`
      DELETE FROM twitter.media_delete_jobs WHERE storage_key IN (
        SELECT storage_key FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[])
      )
    `;
    await this.sql`DELETE FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[])`;
    await this.sql`DELETE FROM twitter.tweet_drafts WHERE id = ANY(${ids}::uuid[])`;
  }
}
