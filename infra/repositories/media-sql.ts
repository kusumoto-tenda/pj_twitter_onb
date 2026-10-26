import type postgres from 'postgres';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 下書きの未投稿の画像を破棄し、実体の削除を予約する（呼び出し側で下書きをロック済みであること）。
 * トークンが有効な間は遅れて届くアップロードで実体が再生成され得るため、削除はトークンの期限後にする。
 */
export async function discardOpenUploads(
  tx: postgres.TransactionSql,
  { draftIds, uploadId, now }: { draftIds: string[]; uploadId?: string; now: Date },
): Promise<void> {
  const uploads = await tx<{ id: string; storage_key: string; token_valid_until: Date }[]>`
    SELECT id, storage_key, token_valid_until
    FROM twitter.media_uploads
    WHERE draft_id = ANY(${draftIds}::uuid[])
      AND status IN ('reserved', 'verified')
      ${uploadId ? tx`AND id = ${uploadId}` : tx``}
    ORDER BY id
    FOR UPDATE
  `;
  if (uploads.length === 0) return;
  await tx`
    UPDATE twitter.media_uploads SET status = 'discarded'
    WHERE id = ANY(${uploads.map((u) => u.id)}::uuid[])
  `;
  for (const upload of uploads) {
    const notBefore = upload.token_valid_until > now ? upload.token_valid_until : now;
    await tx`
      INSERT INTO twitter.media_delete_jobs (storage_key, not_before, next_attempt_at)
      VALUES (${upload.storage_key}, ${notBefore}, ${notBefore})
      ON CONFLICT (storage_key) DO NOTHING
    `;
  }
}
