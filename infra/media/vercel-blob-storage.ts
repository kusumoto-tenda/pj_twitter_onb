import { BlobNotFoundError, del, get, head, list } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import type { MediaStorage } from '@/application/media/ports/media-storage';

/**
 * 非公開のVercel Blobストア。トークンはサーバーだけで使い、クライアントには
 * 指定パスに限定した短命のトークンだけを渡す。
 */
export class VercelBlobStorage implements MediaStorage {
  constructor(private readonly token: string | undefined) {}

  private requireToken(): string {
    if (!this.token) throw new Error('BLOB_READ_WRITE_TOKEN が未設定です。');
    return this.token;
  }

  async createUploadToken({
    pathname,
    maximumSizeInBytes,
    allowedContentTypes,
    validUntil,
  }: Parameters<MediaStorage['createUploadToken']>[0]): Promise<string> {
    return generateClientTokenFromReadWriteToken({
      token: this.requireToken(),
      pathname,
      maximumSizeInBytes,
      allowedContentTypes: [...allowedContentTypes],
      validUntil: validUntil.getTime(),
      // サーバーが決めたパスにそのまま保存し、既存の実体（検証済みを含む）は上書きさせない。
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }

  async inspect(pathname: string) {
    try {
      const blob = await head(pathname, { token: this.requireToken() });
      return { size: blob.size, contentType: blob.contentType };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }

  async open(pathname: string) {
    // CDNのキャッシュを使わず、削除済みの実体を返さないようにする。
    const result = await get(pathname, { access: 'private', token: this.requireToken(), useCache: false });
    return result?.stream ?? null;
  }

  async remove(pathnames: string[]) {
    if (pathnames.length === 0) return;
    await del(pathnames, { token: this.requireToken() });
  }

  async listOlderThan(prefix: string, before: Date) {
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, token: this.requireToken() });
      for (const blob of page.blobs) {
        if (blob.uploadedAt < before) pathnames.push(blob.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return pathnames;
  }
}
