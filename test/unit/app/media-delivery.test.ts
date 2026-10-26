import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMediaStorage, PNG_BYTES } from '@/test/support/fake-media-storage';
import { InMemoryTweetStore } from '@/test/support/in-memory-tweet-writer';

const boundary = vi.hoisted(() => ({ tweetDeps: undefined as unknown, cleanup: vi.fn() }));
vi.mock('@/app/_composition/tweet', () => ({ getTweetDependencies: () => boundary.tweetDeps }));
vi.mock('@/application/media/cleanup-media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/application/media/cleanup-media')>();
  return {
    cleanupMedia: (...args: Parameters<typeof actual.cleanupMedia>) => {
      boundary.cleanup(...args);
      return actual.cleanupMedia(...args);
    },
  };
});

const media = await import('@/app/media/[imageId]/route');
const cron = await import('@/app/api/cron/media-cleanup/route');

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const NOW = new Date();
let store: InMemoryTweetStore;
let storage: FakeMediaStorage;

/** 公開済みの投稿に画像を1枚付ける。 */
async function publishedImage(bytes = PNG_BYTES(2048)) {
  const draftId = '00000000-0000-4000-8000-000000000d01';
  const uploadId = '00000000-0000-4000-8000-000000000e01';
  const storageKey = `tweet-uploads/${draftId}/${uploadId}`;
  await store.createDraft({ id: draftId, ownerId: ALICE, expiresAt: new Date(NOW.getTime() + 3600_000), now: NOW });
  await store.reserveUpload({ actorId: ALICE, draftId, uploadId, storageKey, tokenValidUntil: NOW, now: NOW });
  await store.markVerified({
    actorId: ALICE,
    uploadId,
    image: { size: bytes.byteLength, contentType: 'image/png', width: 10, height: 10 },
    now: NOW,
  });
  await store.publish({ actorId: ALICE, draftId, value: { content: '', uploadIds: [uploadId] }, fingerprint: 'x', now: NOW });
  storage.put(storageKey, bytes, 'image/png');
  return { imageId: store.images[0].id, storageKey, bytes };
}

function get(imageId: string) {
  return media.GET(new Request(`http://localhost:3000/media/${imageId}`), {
    params: Promise.resolve({ imageId }),
  });
}

beforeEach(() => {
  store = new InMemoryTweetStore();
  storage = new FakeMediaStorage();
  boundary.tweetDeps = { tweets: store, media: store, storage, now: () => new Date() };
  boundary.cleanup.mockReset();
  vi.stubEnv('CRON_SECRET', 'cron-test-secret');
});

describe('GET /media/{imageId}', () => {
  it('公開済みの投稿の画像だけを、検証済みの形式・サイズとno-store・nosniffでストリーム配信する', async () => {
    const { imageId, bytes } = await publishedImage();

    const response = await get(imageId);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('未投稿・存在しない・アカウント削除済みの画像は404で、Blobの情報を返さない', async () => {
    const { imageId, storageKey } = await publishedImage();

    expect((await get('00000000-0000-4000-8000-00000000ffff')).status).toBe(404);
    expect((await get('not-a-uuid')).status).toBe(404);
    store.deleteUser(ALICE, NOW);
    const response = await get(imageId);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(storageKey);
  });

  it('DBに行があっても実体がなければ404にする', async () => {
    const { imageId, storageKey } = await publishedImage();
    storage.objects.delete(storageKey);

    expect((await get(imageId)).status).toBe(404);
  });
});

describe('GET /api/cron/media-cleanup', () => {
  it('CRON_SECRETの認証がなければ回収しない', async () => {
    const attempts: Record<string, string>[] = [{}, { authorization: 'Bearer wrong' }, { authorization: 'cron-test-secret' }];
    for (const headers of attempts) {
      const response = await cron.GET(new Request('http://localhost:3000/api/cron/media-cleanup', { headers }));
      expect(response.status).toBe(401);
    }
    expect(boundary.cleanup).not.toHaveBeenCalled();
  });

  it('CRON_SECRETが未設定なら、どの要求も受け付けない', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await cron.GET(
      new Request('http://localhost:3000/api/cron/media-cleanup', { headers: { authorization: 'Bearer ' } }),
    );

    expect(response.status).toBe(401);
    expect(boundary.cleanup).not.toHaveBeenCalled();
  });

  it('認証された要求ではCLIと同じ回収ユースケースを実行し、件数を返す', async () => {
    const response = await cron.GET(
      new Request('http://localhost:3000/api/cron/media-cleanup', {
        headers: { authorization: 'Bearer cron-test-secret' },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expiredDrafts: 0, deleted: 0, failed: 0, orphans: 0 });
    expect(boundary.cleanup).toHaveBeenCalledTimes(1);
  });
});
