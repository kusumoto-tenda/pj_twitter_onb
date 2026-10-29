import type postgres from 'postgres';
import type {
  CommitEditOutcome,
  PrepareEditOutcome,
  TweetEditor,
} from '@/domain/repository_ifs/tweet-editor';
import type { ValidEditTweetInput } from '@/domain/value_objects/tweets/edit-tweet-validation';
import { UUID_PATTERN, discardOpenUploads } from './media-sql';

type ImageRow = { id: string; position: number; width: number; height: number };

/** keepが現在の画像の部分列（元の相対順のまま）か。 */
function keepsRelativeOrder(current: string[], keep: string[]): boolean {
  let index = 0;
  for (const id of current) if (id === keep[index]) index += 1;
  return index === keep.length;
}

export class PostgresTweetEditor implements TweetEditor {
  constructor(private readonly sql: postgres.Sql) {}

  /** 対象の投稿を読み、本人なら現在の内容と版を記録した編集用の下書きを作る。元の投稿は変えない。 */
  async prepare({
    actorId,
    tweetId,
    draftId,
    now,
    expiresAt,
  }: Parameters<TweetEditor['prepare']>[0]): Promise<PrepareEditOutcome> {
    if (!UUID_PATTERN.test(tweetId)) return { status: 'not-found' };
    return this.sql.begin(async (tx): Promise<PrepareEditOutcome> => {
      // 本文・画像・版を同じスナップショットで読む。
      const [tweet] = await tx<{ owner_id: string; content: string; revision: string }[]>`
        SELECT owner_id, content, revision::text AS revision FROM twitter.tweets WHERE id = ${tweetId} FOR SHARE
      `;
      if (!tweet) return { status: 'not-found' };
      if (tweet.owner_id !== actorId) return { status: 'forbidden' };
      const images = await tx<ImageRow[]>`
        SELECT id, position, width, height FROM twitter.images WHERE tweet_id = ${tweetId} ORDER BY position
      `;
      await tx`
        INSERT INTO twitter.tweet_drafts
          (id, owner_id, status, expires_at, created_at, purpose, target_tweet_id, base_revision)
        VALUES (${draftId}, ${actorId}, 'open', ${expiresAt}, ${now}, 'edit', ${tweetId}, ${tweet.revision}::bigint)
      `;
      return {
        status: 'ready',
        value: {
          draftId,
          tweetId,
          content: tweet.content,
          images: images.map(({ id, position, width, height }) => ({ id, position, width, height })),
        },
      };
    });
  }

  /**
   * 編集を確定する。対象投稿→下書き→画像・予約の順にロックし、版が準備時と同じときだけ、
   * 本文と画像（解除・位置の詰め直し・追加）と削除予約を1つのトランザクションで更新する。
   */
  async commit({
    actorId,
    draftId,
    value,
    fingerprint,
    now,
  }: Parameters<TweetEditor['commit']>[0]): Promise<CommitEditOutcome> {
    if (!UUID_PATTERN.test(draftId)) return { status: 'not-found' };
    return this.sql.begin(async (tx): Promise<CommitEditOutcome> => {
      // ロックは投稿→下書き→画像・予約の順にそろえる（削除・アカウント削除・編集の準備と同じ順）。
      // そのため、対象の投稿はロックせずに下書きから読み、投稿をロックしてから下書きをロックして確かめ直す。
      const [target] = await tx<{ purpose: string; owner_id: string | null; target_tweet_id: string | null }[]>`
        SELECT purpose, owner_id, target_tweet_id FROM twitter.tweet_drafts WHERE id = ${draftId}
      `;
      if (!target || target.purpose !== 'edit') return { status: 'not-found' };
      if (target.owner_id !== actorId) return { status: 'forbidden' };
      // 対象は下書きに保存した投稿だけ（クライアントの値で差し替えない）。
      if (!target.target_tweet_id) return { status: 'not-found' };
      const tweetId = target.target_tweet_id;
      const [tweet] = await tx<{ owner_id: string; content: string; revision: string }[]>`
        SELECT owner_id, content, revision::text AS revision FROM twitter.tweets WHERE id = ${tweetId} FOR UPDATE
      `;
      if (!tweet) return { status: 'not-found' };
      if (tweet.owner_id !== actorId) return { status: 'forbidden' };
      const [draft] = await tx<
        {
          owner_id: string | null;
          status: string;
          expires_at: Date;
          fingerprint: string | null;
          target_tweet_id: string | null;
          base_revision: string | null;
        }[]
      >`
        SELECT owner_id, status, expires_at, fingerprint, target_tweet_id, base_revision::text AS base_revision
        FROM twitter.tweet_drafts WHERE id = ${draftId} FOR UPDATE
      `;
      // 投稿をロックしている間は対象が変わらない（対象がNULLになるのは投稿の削除時だけ）。
      if (!draft || draft.target_tweet_id !== tweetId) return { status: 'not-found' };
      if (draft.owner_id !== actorId) return { status: 'forbidden' };

      if (draft.status === 'published') {
        return draft.fingerprint === fingerprint
          ? { status: 'updated', tweetId, replayed: true }
          : { status: 'conflict' };
      }
      if (draft.status !== 'open' || draft.expires_at <= now) return { status: 'draft-closed' };
      // 版はBIGINTを文字列のまま比べる（JSの数値に丸めない）。
      if (tweet.revision !== draft.base_revision) return { status: 'conflict' };

      const images = await this.applyImages(tx, { actorId, draftId, tweetId, value });
      if ('status' in images) return images;

      // 内容が実際に変わったときだけ、版と編集日時を進める。
      if (tweet.content !== value.content || images.changed) {
        await tx`
          UPDATE twitter.tweets
          SET content = ${value.content},
              revision = revision + 1,
              updated_at = GREATEST(${now}::timestamptz, updated_at + interval '1 microsecond')
          WHERE id = ${tweetId}
        `;
      }
      // 使わなかった新規画像は破棄して削除を予約する。
      await discardOpenUploads(tx, { draftIds: [draftId], now });
      await tx`
        UPDATE twitter.tweet_drafts
        SET status = 'published', fingerprint = ${fingerprint}, published_tweet_id = ${tweetId}
        WHERE id = ${draftId}
      `;
      return { status: 'updated', tweetId, replayed: false };
    });
  }

  /**
   * 画像を更新する。保持する画像はDELETE/再INSERTせず位置だけ詰め、解除した画像だけを削除する
   * （既存のトリガーが削除予約を作る）。問題があれば書き込まずに結果を返す。
   */
  private async applyImages(
    tx: postgres.TransactionSql,
    { actorId, draftId, tweetId, value }: { actorId: string; draftId: string; tweetId: string; value: ValidEditTweetInput },
  ): Promise<CommitEditOutcome | { changed: boolean }> {
    const current = await tx<{ id: string; position: number }[]>`
      SELECT id, position FROM twitter.images WHERE tweet_id = ${tweetId} ORDER BY id FOR UPDATE
    `;
    const currentOrder = [...current].sort((a, b) => a.position - b.position).map((i) => i.id);
    if (!keepsRelativeOrder(currentOrder, value.keepImageIds)) return { status: 'invalid-images' };

    const uploads =
      value.uploadIds.length === 0
        ? []
        : await tx<
            {
              id: string;
              draft_id: string;
              owner_id: string | null;
              status: string;
              storage_key: string;
              size_bytes: number;
              content_type: string;
              width: number;
              height: number;
            }[]
          >`
            SELECT id, draft_id, owner_id, status, storage_key, size_bytes, content_type, width, height
            FROM twitter.media_uploads WHERE id = ANY(${value.uploadIds}::uuid[]) ORDER BY id FOR UPDATE
          `;
    const byId = new Map(uploads.map((u) => [u.id, u]));
    const ordered = value.uploadIds.map((id) => byId.get(id));
    if (ordered.some((u) => !u || u.draft_id !== draftId || u.owner_id !== actorId || u.status !== 'verified')) {
      return { status: 'upload-not-ready' };
    }

    const removed = currentOrder.filter((id) => !value.keepImageIds.includes(id));
    if (removed.length === 0 && ordered.length === 0) return { changed: false };

    await tx`SET CONSTRAINTS twitter.images_tweet_position_unique DEFERRED`;
    if (removed.length > 0) {
      await tx`DELETE FROM twitter.images WHERE id = ANY(${removed}::uuid[])`;
    }
    for (const [position, id] of value.keepImageIds.entries()) {
      await tx`UPDATE twitter.images SET position = ${position} WHERE id = ${id} AND position <> ${position}`;
    }
    for (const [index, upload] of ordered.entries()) {
      await tx`
        INSERT INTO twitter.images
          (id, tweet_id, upload_id, storage_key, position, size_bytes, content_type, width, height)
        VALUES (
          gen_random_uuid(), ${tweetId}, ${upload!.id}, ${upload!.storage_key}, ${value.keepImageIds.length + index},
          ${upload!.size_bytes}, ${upload!.content_type}, ${upload!.width}, ${upload!.height}
        )
      `;
    }
    if (ordered.length > 0) {
      await tx`UPDATE twitter.media_uploads SET status = 'attached' WHERE id = ANY(${value.uploadIds}::uuid[])`;
    }
    return { changed: true };
  }
}
