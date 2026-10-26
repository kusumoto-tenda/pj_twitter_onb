import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blob = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ put: blob.put }));

const { blobImageUploader } = await import('@/app/ui/tweets/image-uploader');

const UPLOAD_ID = '00000000-0000-4000-8000-000000000001';
const file = () => new File([new Uint8Array(4)], 'a.png', { type: 'image/png' });

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  blob.put.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function reserveSucceeds() {
  fetchMock.mockResolvedValueOnce(json(200, { uploadId: UPLOAD_ID, pathname: 'tweet-uploads/d/u', token: 't' }));
}

async function upload(signal = new AbortController().signal) {
  return blobImageUploader.upload({ draftId: 'draft-1', file: file(), signal, onStage: vi.fn() });
}

describe('blobImageUploader.upload', () => {
  it('予約→直接アップロード→検証に成功したらuploadIdを返す', async () => {
    reserveSucceeds();
    blob.put.mockResolvedValue({});
    fetchMock.mockResolvedValueOnce(json(200, { uploadId: UPLOAD_ID, width: 1, height: 1 }));

    expect(await upload()).toEqual({ ok: true, uploadId: UPLOAD_ID });
  });

  it('予約後にBlobへの送信が通信エラーになったら、予約を解放できるようuploadIdを返す', async () => {
    reserveSucceeds();
    blob.put.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await upload()).toMatchObject({ ok: false, uploadId: UPLOAD_ID });
  });

  it('予約後に検証要求が通信エラーになっても、uploadIdを返す', async () => {
    reserveSucceeds();
    blob.put.mockResolvedValue({});
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await upload()).toMatchObject({ ok: false, uploadId: UPLOAD_ID });
  });

  it('予約後に中断されても、uploadIdを返す', async () => {
    const controller = new AbortController();
    reserveSucceeds();
    blob.put.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });

    expect(await upload(controller.signal)).toMatchObject({ ok: false, uploadId: UPLOAD_ID });
  });

  it('予約自体が失敗したら、uploadIdなしで理由を返す', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { code: 'LIMIT_REACHED', message: '画像は4枚まで添付できます' }));

    expect(await upload()).toEqual({ ok: false, message: '画像は4枚まで添付できます' });
    expect(blob.put).not.toHaveBeenCalled();
  });
});
