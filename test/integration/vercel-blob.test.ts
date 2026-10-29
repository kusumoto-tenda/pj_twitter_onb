import { randomUUID } from 'node:crypto';
import { put as clientPut } from '@vercel/blob/client';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadPathname } from '@/domain/value_objects/media/media';
import { reserveImageUpload } from '@/application/usecases/media/reserve-image-upload';
import { verifyImageUpload } from '@/application/usecases/media/verify-image-upload';
import { beginTweetDraft } from '@/application/usecases/tweets/begin-tweet-draft';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '@/domain/value_objects/tweets/tweet-validation';
import { SharpImageInspector } from '@/infra/external_services/media/sharp-image-inspector';
import { VercelBlobStorage } from '@/infra/external_services/media/vercel-blob-storage';
import { requireTestBlobEnvironment } from '@/test/support/blob-environment';
import { InMemoryTweetStore } from '@/test/support/in-memory-tweet-writer';

// 実体を作る前に、テスト用ストアであることを確認する（資格情報がなければ失敗する）。
const { token } = requireTestBlobEnvironment(process.env);
const storage = new VercelBlobStorage(token);
const inspector = new SharpImageInspector();
const created: string[] = [];
const run = randomUUID();

function testPath(name: string) {
  const pathname = uploadPathname(run, `${name}-${randomUUID()}`);
  created.push(pathname);
  return pathname;
}

async function issueToken(pathname: string) {
  return storage.createUploadToken({
    pathname,
    maximumSizeInBytes: MAX_IMAGE_BYTES,
    allowedContentTypes: ALLOWED_IMAGE_TYPES,
    validUntil: new Date(Date.now() + 15 * 60_000),
  });
}

/** ブラウザと同じくクライアント用トークンで直接アップロードする（アプリのリクエストを通らない）。 */
async function browserUpload(pathname: string, body: Uint8Array | Buffer, contentType: string) {
  return clientPut(pathname, Buffer.from(body), {
    access: 'private',
    token: await issueToken(pathname),
    contentType,
  });
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

let png: Buffer;
let jpeg: Buffer;

beforeAll(async () => {
  png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3399ff' } }).png().toBuffer();
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#ff9933' } }).jpeg().toBuffer();
});

afterAll(async () => {
  // 作成したパスだけを削除する（ストア全体は消さない）。
  if (created.length > 0) await storage.remove(created);
});

describe('VercelBlobStorage（テスト用の非公開ストア）', () => {
  it('JPEG・PNGを直接アップロードし、メタデータ・ストリーム取得・削除ができる', async () => {
    for (const [body, type] of [
      [png, 'image/png'],
      [jpeg, 'image/jpeg'],
    ] as const) {
      const pathname = testPath('roundtrip');
      await browserUpload(pathname, body, type);

      expect(await storage.inspect(pathname)).toEqual({ size: body.byteLength, contentType: type });
      const stream = await storage.open(pathname);
      expect(stream).not.toBeNull();
      expect((await readAll(stream!)).equals(body)).toBe(true);

      await storage.remove([pathname]);
      expect(await storage.inspect(pathname)).toBeNull();
      expect(await storage.open(pathname)).toBeNull();
    }
  });

  it('非公開のため、Blobの直接URLは認証なしで取得できない', async () => {
    const pathname = testPath('private');
    const result = await browserUpload(pathname, png, 'image/png');

    const response = await fetch(result.url);
    expect(response.ok).toBe(false);
  });

  it('トークンに設定した形式・サイズ以外はアップロードできない', async () => {
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary');
    await expect(browserUpload(testPath('gif'), gif, 'image/gif')).rejects.toThrow();
    await expect(browserUpload(testPath('too-large'), new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png')).rejects.toThrow();
  });

  it('上限ちょうど（5MB）はアップロードできる', async () => {
    const pathname = testPath('exact');
    const body = new Uint8Array(MAX_IMAGE_BYTES);
    body.set(png);
    await browserUpload(pathname, body, 'image/png');

    expect((await storage.inspect(pathname))?.size).toBe(MAX_IMAGE_BYTES);
  }, 120_000);

  it('アップロード済みのパスは、新しいトークンでも上書きできない', async () => {
    const pathname = testPath('overwrite');
    await browserUpload(pathname, png, 'image/png');

    await expect(browserUpload(pathname, jpeg, 'image/jpeg')).rejects.toThrow();
    expect(await storage.inspect(pathname)).toEqual({ size: png.byteLength, contentType: 'image/png' });
  });

  it('指定時刻より前にアップロードされたものだけを一覧する', async () => {
    const pathname = testPath('list');
    await browserUpload(pathname, png, 'image/png');

    expect(await storage.listOlderThan(`tweet-uploads/${run}/`, new Date(Date.now() + 60_000))).toContain(pathname);
    expect(await storage.listOlderThan(`tweet-uploads/${run}/`, new Date(Date.now() - 3600_000))).not.toContain(pathname);
  });
});

describe('予約→直接アップロード→検証（実ストア・実画像検査）', () => {
  it('完了webhookなしで、検証要求だけで実体を確認してverifiedにする', async () => {
    const store = new InMemoryTweetStore();
    const alice = randomUUID();
    const deps = { tweets: store, media: store, storage, inspector, newId: randomUUID, now: () => new Date() };
    const draft = await beginTweetDraft(deps, { actorId: alice });
    if (!draft.ok) throw new Error(draft.code);

    const reserved = await reserveImageUpload(deps, {
      actorId: alice,
      draftId: draft.draftId,
      contentType: 'image/jpeg',
      size: jpeg.byteLength,
    });
    if (!reserved.ok) throw new Error(reserved.code);
    created.push(reserved.pathname);
    await clientPut(reserved.pathname, jpeg, { access: 'private', token: reserved.token, contentType: 'image/jpeg' });

    expect(await verifyImageUpload(deps, { actorId: alice, uploadId: reserved.uploadId })).toEqual({
      ok: true,
      upload: { id: reserved.uploadId, width: 64, height: 48 },
    });
  });

  it('Content-Typeを偽装した実体（PNGをJPEGとして送信）は検証で拒否する', async () => {
    const store = new InMemoryTweetStore();
    const alice = randomUUID();
    const deps = { tweets: store, media: store, storage, inspector, newId: randomUUID, now: () => new Date() };
    const draft = await beginTweetDraft(deps, { actorId: alice });
    if (!draft.ok) throw new Error(draft.code);
    const reserved = await reserveImageUpload(deps, {
      actorId: alice,
      draftId: draft.draftId,
      contentType: 'image/jpeg',
      size: png.byteLength,
    });
    if (!reserved.ok) throw new Error(reserved.code);
    created.push(reserved.pathname);
    await clientPut(reserved.pathname, png, { access: 'private', token: reserved.token, contentType: 'image/jpeg' });

    expect(await verifyImageUpload(deps, { actorId: alice, uploadId: reserved.uploadId })).toMatchObject({
      ok: false,
      code: 'INVALID_IMAGE',
    });
  });
});

describe('SharpImageInspector', () => {
  it('JPEG・PNGの形式と寸法を返し、壊れた画像・画像でないデータはnullにする', async () => {
    expect(await inspector.inspect(png)).toEqual({ format: 'png', width: 40, height: 30 });
    expect(await inspector.inspect(jpeg)).toEqual({ format: 'jpeg', width: 64, height: 48 });
    expect(await inspector.inspect(jpeg.subarray(0, jpeg.byteLength / 2))).toBeNull();
    expect(await inspector.inspect(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).not.toMatchObject({ format: 'png' });
    expect(await inspector.inspect(Buffer.from('not an image'))).toBeNull();
  });

  it('画素数が上限を超える画像はデコードせず寸法だけを返す（上限の判定は業務ルール側）', async () => {
    const huge = await sharp({ create: { width: 8001, height: 5000, channels: 3, background: '#000' } }).png().toBuffer();

    expect(await inspector.inspect(huge)).toEqual({ format: 'png', width: 8001, height: 5000 });
  }, 60_000);
});
