import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '@/application/usecases/users/create-account';
import { FIXED_ID, createTestDependencies, validInput } from '@/test/support/account-fixtures';
import {
  FakeImageInspector,
  FakeMediaStorage,
  JPEG_BYTES,
  PNG_BYTES,
} from '@/test/support/fake-media-storage';
import { InMemoryTweetStore } from '@/test/support/in-memory-tweet-writer';

const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const ORIGIN = 'http://localhost:3000';

const boundary = vi.hoisted(() => ({
  session: null as unknown,
  accountDeps: undefined as unknown,
  tweetDeps: undefined as unknown,
}));

vi.mock('@/app/_auth/auth', () => ({ auth: vi.fn(async () => boundary.session) }));
vi.mock('@/main/container/account', () => ({ getAccountDependencies: () => boundary.accountDeps }));
vi.mock('@/main/container/tweet', () => ({ getTweetDependencies: () => boundary.tweetDeps }));

const upload = await import('@/app/api/tweet-images/upload/route');
const verify = await import('@/app/api/tweet-images/verify/route');
const discard = await import('@/app/api/tweet-images/discard/route');

let store: InMemoryTweetStore;
let storage: FakeMediaStorage;
let seq = 0;

function signIn(id: string | null) {
  boundary.session = id ? { user: { id }, expires: '2099-01-01T00:00:00Z' } : null;
}

function post(path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function draft(ownerId = FIXED_ID) {
  const id = `00000000-0000-4000-8000-${String(700 + seq++).padStart(12, '0')}`;
  await store.createDraft({ id, ownerId, expiresAt: new Date(Date.now() + 3600_000), now: new Date() });
  return id;
}

beforeEach(async () => {
  const accounts = createTestDependencies();
  await createAccount(accounts.deps, validInput); // FIXED_ID
  await createAccount(accounts.deps, { ...validInput, name: 'ボブ', displayId: 'Bob_12' }); // OTHER_ID
  boundary.accountDeps = accounts.deps;
  store = new InMemoryTweetStore();
  storage = new FakeMediaStorage();
  let n = 0;
  boundary.tweetDeps = {
    tweets: store,
    media: store,
    storage,
    inspector: new FakeImageInspector(),
    newId: () => `00000000-0000-4000-8000-${String(800 + n++).padStart(12, '0')}`,
    now: () => new Date(),
  };
  signIn(FIXED_ID);
});

describe('POST /api/tweet-images/upload', () => {
  it('本人の下書きに予約し、予約パス限定のトークンを返す（サーバーの資格情報は返さない）', async () => {
    const draftId = await draft();

    const response = await upload.POST(post('/api/tweet-images/upload', { draftId, contentType: 'image/png', size: 100 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      uploadId: expect.any(String),
      pathname: `tweet-uploads/${draftId}/${body.uploadId}`,
      token: `token-for:tweet-uploads/${draftId}/${body.uploadId}`,
    });
    expect(JSON.stringify(body)).not.toContain('BLOB_READ_WRITE_TOKEN');
  });

  it.each([
    ['Originなし', {}],
    ['別のOrigin', { origin: 'https://evil.example' }],
  ])('%sは拒否し、予約しない', async (_label, headers) => {
    const draftId = await draft();

    const response = await upload.POST(
      post('/api/tweet-images/upload', { draftId, contentType: 'image/png', size: 100 }, headers),
    );

    expect(response.status).toBe(403);
    expect(store.uploads.size).toBe(0);
  });

  it('未ログインは401、他人の下書きは403で、予約しない', async () => {
    const draftId = await draft(OTHER_ID);

    signIn(null);
    expect((await upload.POST(post('/api/tweet-images/upload', { draftId, contentType: 'image/png', size: 1 }))).status).toBe(401);
    signIn(FIXED_ID);
    expect((await upload.POST(post('/api/tweet-images/upload', { draftId, contentType: 'image/png', size: 1 }))).status).toBe(403);
    expect(store.uploads.size).toBe(0);
  });

  it('許可しない形式・サイズ・不正な本文は400で、トークンを発行しない', async () => {
    const draftId = await draft();

    for (const body of [
      { draftId, contentType: 'image/gif', size: 100 },
      { draftId, contentType: 'image/png', size: 5 * 1024 * 1024 + 1 },
      { draftId, contentType: 'image/png' },
      { draftId: 123, contentType: 'image/png', size: 1 },
      { draftId, uploadId: 123, contentType: 'image/png', size: 1 },
      { draftId, uploadId: 'not-a-uuid', contentType: 'image/png', size: 1 },
    ]) {
      expect((await upload.POST(post('/api/tweet-images/upload', body))).status).toBe(400);
    }
    expect(storage.tokens).toHaveLength(0);
  });

  it('クライアントが決めたIDで予約し、同じIDの再送では枠を増やさない', async () => {
    const draftId = await draft();
    const uploadId = '00000000-0000-4000-8000-0000000000c1';
    const body = { draftId, uploadId, contentType: 'image/png', size: 1 };

    const first = await upload.POST(post('/api/tweet-images/upload', body));
    const resent = await upload.POST(post('/api/tweet-images/upload', body));

    expect(first.status).toBe(200);
    expect(resent.status).toBe(200);
    expect(await resent.json()).toMatchObject({ uploadId, pathname: `tweet-uploads/${draftId}/${uploadId}` });
    expect(store.uploads.size).toBe(1);
  });

  it('5枚目は409で拒否する', async () => {
    const draftId = await draft();
    for (let i = 0; i < 4; i++) {
      expect((await upload.POST(post('/api/tweet-images/upload', { draftId, contentType: 'image/png', size: 1 }))).status).toBe(200);
    }

    const response = await upload.POST(post('/api/tweet-images/upload', { draftId, contentType: 'image/png', size: 1 }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'LIMIT_REACHED', message: '画像は4枚まで添付できます' });
  });
});

describe('POST /api/tweet-images/verify', () => {
  async function reserved(bytes: Uint8Array, contentType: string) {
    const draftId = await draft();
    const response = await upload.POST(post('/api/tweet-images/upload', { draftId, contentType, size: bytes.byteLength }));
    const { uploadId, pathname } = await response.json();
    storage.put(pathname, bytes, contentType);
    return uploadId as string;
  }

  it('本人のアップロード済み画像を検証し、寸法を返す', async () => {
    const uploadId = await reserved(PNG_BYTES(), 'image/png');

    const response = await verify.POST(post('/api/tweet-images/verify', { uploadId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uploadId, width: 100, height: 80 });
  });

  it('偽装・壊れた画像は400で、理由を返す', async () => {
    const uploadId = await reserved(JPEG_BYTES(), 'image/png');

    const response = await verify.POST(post('/api/tweet-images/verify', { uploadId }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'INVALID_IMAGE', message: 'JPEG・PNG画像のみ添付できます' });
  });

  it('他人は403、別のOriginは403、未ログインは401', async () => {
    const uploadId = await reserved(PNG_BYTES(), 'image/png');

    signIn(OTHER_ID);
    expect((await verify.POST(post('/api/tweet-images/verify', { uploadId }))).status).toBe(403);
    signIn(FIXED_ID);
    expect((await verify.POST(post('/api/tweet-images/verify', { uploadId }, { origin: 'https://evil.example' }))).status).toBe(403);
    signIn(null);
    expect((await verify.POST(post('/api/tweet-images/verify', { uploadId }))).status).toBe(401);
    expect(store.uploads.get(uploadId)?.status).toBe('reserved');
  });

  it('クライアントが申告したURL・サイズ・verifiedは無視し、サーバーの予約パスだけを検査する', async () => {
    const uploadId = await reserved(JPEG_BYTES(), 'image/png');

    const response = await verify.POST(
      post('/api/tweet-images/verify', {
        uploadId,
        url: 'https://example.com/ok.png',
        size: 1,
        contentType: 'image/jpeg',
        verified: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(store.uploads.get(uploadId)?.status).toBe('reserved');
  });
});

describe('POST /api/tweet-images/discard', () => {
  it('画像の解除・下書きの破棄は本人だけができる', async () => {
    const draftId = await draft();
    const res = await upload.POST(post('/api/tweet-images/upload', { draftId, contentType: 'image/png', size: 1 }));
    const { uploadId } = await res.json();

    signIn(OTHER_ID);
    expect((await discard.POST(post('/api/tweet-images/discard', { uploadId }))).status).toBe(403);
    expect((await discard.POST(post('/api/tweet-images/discard', { draftId }))).status).toBe(403);
    signIn(FIXED_ID);
    expect((await discard.POST(post('/api/tweet-images/discard', { uploadId }))).status).toBe(200);
    expect(store.uploads.get(uploadId)?.status).toBe('discarded');
    expect((await discard.POST(post('/api/tweet-images/discard', { draftId }))).status).toBe(200);
    expect(store.drafts.get(draftId)?.status).toBe('discarded');
  });

  it('予約より先に届いた解除（draftId付き）の後は、同じIDの予約を400で拒否する', async () => {
    const draftId = await draft();
    const uploadId = '00000000-0000-4000-8000-0000000000c2';

    expect((await discard.POST(post('/api/tweet-images/discard', { uploadId, draftId }))).status).toBe(200);
    const late = await upload.POST(post('/api/tweet-images/upload', { draftId, uploadId, contentType: 'image/png', size: 1 }));

    expect(late.status).toBe(400);
    expect(storage.tokens).toHaveLength(0);
  });

  it('別のOrigin・不正な本文は拒否する', async () => {
    const draftId = await draft();

    expect((await discard.POST(post('/api/tweet-images/discard', { draftId }, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await discard.POST(post('/api/tweet-images/discard', {}))).status).toBe(400);
    expect(store.drafts.get(draftId)?.status).toBe('open');
  });
});
