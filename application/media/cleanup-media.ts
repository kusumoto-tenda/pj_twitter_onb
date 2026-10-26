import { ORPHAN_GRACE_MS, UPLOAD_PREFIX } from './media';
import type { MediaRepository } from './ports/media-repository';
import type { MediaStorage } from './ports/media-storage';

export type CleanupMediaResult = {
  expiredDrafts: number;
  deleted: number;
  failed: number;
  orphans: number;
};

const RETRY_DELAY_MS = 60 * 60 * 1000;

/**
 * 画像の回収。CLIとCronの両方から呼ぶ。
 * DBとストレージは1つのトランザクションにできないため、削除に失敗した予約は残して後で再試行する。
 */
export async function cleanupMedia(
  deps: {
    media: Pick<
      MediaRepository,
      | 'discardExpiredDrafts'
      | 'claimDueDeleteJobs'
      | 'completeDeleteJob'
      | 'failDeleteJob'
      | 'findKeptStorageKeys'
    >;
    storage: Pick<MediaStorage, 'remove' | 'listOlderThan'>;
    now: () => Date;
  },
  { limit = 100 }: { limit?: number },
): Promise<CleanupMediaResult> {
  const now = deps.now();
  const result: CleanupMediaResult = { expiredDrafts: 0, deleted: 0, failed: 0, orphans: 0 };

  result.expiredDrafts = await deps.media.discardExpiredDrafts({ now, limit });

  for (const storageKey of await deps.media.claimDueDeleteJobs({ now, limit })) {
    try {
      await deps.storage.remove([storageKey]);
      await deps.media.completeDeleteJob(storageKey);
      result.deleted += 1;
    } catch {
      await deps.media.failDeleteJob(storageKey, {
        errorCode: 'STORAGE_ERROR',
        nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
      });
      result.failed += 1;
    }
  }

  // DBに記録が残らなかった実体（予約前の失敗など）を、十分古いものだけ照合して回収する。
  const candidates = await deps.storage.listOlderThan(UPLOAD_PREFIX, new Date(now.getTime() - ORPHAN_GRACE_MS));
  if (candidates.length > 0) {
    const kept = await deps.media.findKeptStorageKeys(candidates);
    const orphans = candidates.filter((key) => !kept.has(key)).slice(0, limit);
    if (orphans.length > 0) {
      try {
        await deps.storage.remove(orphans);
        result.orphans = orphans.length;
      } catch {
        // 孤立した実体は次回の照合でも見つかるため、記録だけして続ける。
        result.failed += orphans.length;
      }
    }
  }
  return result;
}
