import type postgres from 'postgres';
import type {
  MediaRepository,
  OwnedUpload,
  ReserveUploadOutcome,
} from '@/application/media/ports/media-repository';
import { uploadPathname } from '@/application/media/media';
import type { UploadStatus, VerifiedImage } from '@/application/media/media';
import { MAX_IMAGES_PER_TWEET } from '@/domain/tweets/tweet-validation';
import { UUID_PATTERN, discardOpenUploads } from './media-sql';

export class PostgresMediaRepository implements MediaRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async reserveUpload(input: {
    actorId: string;
    draftId: string;
    uploadId: string;
    storageKey: string;
    tokenValidUntil: Date;
    now: Date;
  }): Promise<ReserveUploadOutcome> {
    if (!UUID_PATTERN.test(input.draftId)) return 'draft-not-found';
    return this.sql.begin(async (tx): Promise<ReserveUploadOutcome> => {
      // 下書きをロックして同時の予約を順番に処理し、使用中が4枚を超えないようにする。
      const [draft] = await tx<{ owner_id: string | null; status: string; expires_at: Date }[]>`
        SELECT owner_id, status, expires_at FROM twitter.tweet_drafts WHERE id = ${input.draftId} FOR UPDATE
      `;
      if (!draft) return 'draft-not-found';
      if (draft.owner_id !== input.actorId) return 'forbidden';
      if (draft.status !== 'open' || draft.expires_at <= input.now) return 'draft-closed';
      const [existing] = await tx<{ draft_id: string; owner_id: string | null; status: UploadStatus }[]>`
        SELECT draft_id, owner_id, status FROM twitter.media_uploads WHERE id = ${input.uploadId} FOR UPDATE
      `;
      if (existing) {
        if (existing.owner_id !== input.actorId) return 'forbidden';
        if (existing.draft_id !== input.draftId || existing.status !== 'reserved') return 'conflict';
        // 応答を失った予約の再送。新しく発行するトークンの期限まで削除を待てるよう期限を延ばす。
        await tx`
          UPDATE twitter.media_uploads
          SET token_valid_until = GREATEST(token_valid_until, ${input.tokenValidUntil})
          WHERE id = ${input.uploadId}
        `;
        return 'reserved';
      }
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM twitter.media_uploads
        WHERE draft_id = ${input.draftId} AND status IN ('reserved', 'verified')
      `;
      if (count >= MAX_IMAGES_PER_TWEET) return 'limit-reached';
      await tx`
        INSERT INTO twitter.media_uploads
          (id, draft_id, owner_id, storage_key, status, token_valid_until, created_at)
        VALUES (
          ${input.uploadId}, ${input.draftId}, ${input.actorId}, ${input.storageKey}, 'reserved',
          ${input.tokenValidUntil}, ${input.now}
        )
      `;
      return 'reserved';
    });
  }

  async findOwnedUpload({ actorId, uploadId, now }: { actorId: string; uploadId: string; now: Date }) {
    if (!UUID_PATTERN.test(uploadId)) return { status: 'not-found' as const };
    const [row] = await this.sql<
      {
        id: string;
        draft_id: string;
        owner_id: string | null;
        storage_key: string;
        status: UploadStatus;
        draft_status: string;
        expires_at: Date;
      }[]
    >`
      SELECT u.id, u.draft_id, u.owner_id, u.storage_key, u.status, d.status AS draft_status, d.expires_at
      FROM twitter.media_uploads u JOIN twitter.tweet_drafts d ON d.id = u.draft_id
      WHERE u.id = ${uploadId}
    `;
    if (!row) return { status: 'not-found' as const };
    if (row.owner_id !== actorId) return { status: 'forbidden' as const };
    if (row.draft_status !== 'open' || row.expires_at <= now) return { status: 'draft-closed' as const };
    const upload: OwnedUpload = {
      id: row.id,
      draftId: row.draft_id,
      storageKey: row.storage_key,
      status: row.status,
    };
    return { status: 'found' as const, upload };
  }

  async markVerified({ actorId, uploadId, image }: { actorId: string; uploadId: string; image: VerifiedImage; now: Date }) {
    // reservedで、下書きが未投稿のものだけを更新する。破棄済みなどはverifiedへ戻さない。
    const rows = await this.sql`
      UPDATE twitter.media_uploads u
      SET status = 'verified', size_bytes = ${image.size}, content_type = ${image.contentType},
          width = ${image.width}, height = ${image.height}
      FROM twitter.tweet_drafts d
      WHERE u.id = ${uploadId} AND u.owner_id = ${actorId} AND u.status = 'reserved'
        AND d.id = u.draft_id AND d.status = 'open'
      RETURNING u.id
    `;
    return rows.length === 1 ? ('verified' as const) : ('not-reservable' as const);
  }

  async discardUpload({ actorId, uploadId, draftId, now }: { actorId: string; uploadId: string; draftId?: string; now: Date }) {
    if (!UUID_PATTERN.test(uploadId)) return 'not-found' as const;
    return this.sql.begin(async (tx) => {
      const findUpload = () => tx<{ draft_id: string }[]>`
        SELECT draft_id FROM twitter.media_uploads WHERE id = ${uploadId}
      `;
      let [found] = await findUpload();
      if (!found) {
        if (draftId === undefined || !UUID_PATTERN.test(draftId)) return 'not-found' as const;
        // 予約より先に解除が届いた。予約と同じく下書きをロックして順番をそろえ、まだ予約が無ければ破棄済みの印を残す。
        const [draft] = await tx<{ owner_id: string | null; status: string; expires_at: Date }[]>`
          SELECT owner_id, status, expires_at FROM twitter.tweet_drafts WHERE id = ${draftId} FOR UPDATE
        `;
        if (!draft) return 'not-found' as const;
        if (draft.owner_id !== actorId) return 'forbidden' as const;
        [found] = await findUpload();
        if (!found) {
          // 閉じた下書きにはもう予約できないため、印は要らない。
          if (draft.status !== 'open' || draft.expires_at <= now) return 'not-found' as const;
          const storageKey = uploadPathname(draftId, uploadId);
          await tx`
            INSERT INTO twitter.media_uploads
              (id, draft_id, owner_id, storage_key, status, token_valid_until, created_at)
            VALUES (${uploadId}, ${draftId}, ${actorId}, ${storageKey}, 'discarded', ${now}, ${now})
          `;
          // 下書きの期限が切れれば予約は来ないため、その後に印ごと片付ける。
          await tx`
            INSERT INTO twitter.media_delete_jobs (storage_key, not_before, next_attempt_at)
            VALUES (${storageKey}, ${draft.expires_at}, ${draft.expires_at})
            ON CONFLICT (storage_key) DO NOTHING
          `;
          return 'discarded' as const;
        }
      }
      // 投稿確定と同じく、下書き→画像の順にロックする。
      await tx`SELECT 1 FROM twitter.tweet_drafts WHERE id = ${found.draft_id} FOR UPDATE`;
      const [upload] = await tx<{ owner_id: string | null; status: UploadStatus }[]>`
        SELECT owner_id, status FROM twitter.media_uploads WHERE id = ${uploadId} FOR UPDATE
      `;
      if (upload.owner_id !== actorId) return 'forbidden' as const;
      if (upload.status === 'attached') return 'attached' as const;
      await discardOpenUploads(tx, { draftIds: [found.draft_id], uploadId, now });
      return 'discarded' as const;
    });
  }

  async discardExpiredDrafts({ now, limit }: { now: Date; limit: number }) {
    return this.sql.begin(async (tx) => {
      const drafts = await tx<{ id: string }[]>`
        SELECT id FROM twitter.tweet_drafts
        WHERE status = 'open' AND expires_at <= ${now}
        ORDER BY id LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (drafts.length === 0) return 0;
      const ids = drafts.map((d) => d.id);
      await tx`UPDATE twitter.tweet_drafts SET status = 'discarded' WHERE id = ANY(${ids}::uuid[])`;
      await discardOpenUploads(tx, { draftIds: ids, now });
      return drafts.length;
    });
  }

  async claimDueDeleteJobs({ now, limit }: { now: Date; limit: number }) {
    const rows = await this.sql<{ storage_key: string }[]>`
      SELECT storage_key FROM twitter.media_delete_jobs
      WHERE not_before <= ${now} AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at
      LIMIT ${limit}
    `;
    return rows.map((r) => r.storage_key);
  }

  async completeDeleteJob(storageKey: string) {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM twitter.media_delete_jobs WHERE storage_key = ${storageKey}`;
      await tx`
        DELETE FROM twitter.media_uploads u
        WHERE u.storage_key = ${storageKey} AND u.status IN ('discarded', 'deleting')
          AND NOT EXISTS (SELECT 1 FROM twitter.images i WHERE i.upload_id = u.id)
      `;
    });
  }

  async failDeleteJob(storageKey: string, { errorCode, nextAttemptAt }: { errorCode: string; nextAttemptAt: Date }) {
    await this.sql`
      UPDATE twitter.media_delete_jobs
      SET attempts = attempts + 1, last_error_code = ${errorCode}, next_attempt_at = ${nextAttemptAt}
      WHERE storage_key = ${storageKey}
    `;
  }

  async findKeptStorageKeys(storageKeys: string[]) {
    if (storageKeys.length === 0) return new Set<string>();
    const rows = await this.sql<{ storage_key: string }[]>`
      SELECT storage_key FROM twitter.images WHERE storage_key = ANY(${storageKeys})
      UNION
      SELECT storage_key FROM twitter.media_uploads
      WHERE storage_key = ANY(${storageKeys}) AND status IN ('reserved', 'verified', 'attached')
    `;
    return new Set(rows.map((r) => r.storage_key));
  }

  async findPublishedImage(imageId: string) {
    if (!UUID_PATTERN.test(imageId)) return null;
    const [row] = await this.sql<{ storage_key: string; content_type: string; size_bytes: number }[]>`
      SELECT i.storage_key, i.content_type, i.size_bytes
      FROM twitter.images i JOIN twitter.tweets t ON t.id = i.tweet_id
      WHERE i.id = ${imageId}
    `;
    return row ? { storageKey: row.storage_key, contentType: row.content_type, size: row.size_bytes } : null;
  }
}
