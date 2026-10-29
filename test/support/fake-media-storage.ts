import type { ImageInspector } from '@/domain/external_service_ifs/media/image-inspector';
import type { MediaStorage } from '@/domain/external_service_ifs/media/media-storage';

type StoredObject = { bytes: Uint8Array; contentType: string; uploadedAt: Date };

/** 外部ストレージのテスト用。障害や読み取り量も観測できる。 */
export class FakeMediaStorage implements MediaStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly tokens: Parameters<MediaStorage['createUploadToken']>[0][] = [];
  readonly removed: string[] = [];
  bytesRead = 0;
  failRemove = false;

  put(pathname: string, bytes: Uint8Array, contentType: string, uploadedAt = new Date()) {
    this.objects.set(pathname, { bytes, contentType, uploadedAt });
  }

  async createUploadToken(input: Parameters<MediaStorage['createUploadToken']>[0]) {
    this.tokens.push(input);
    return `token-for:${input.pathname}`;
  }

  async inspect(pathname: string) {
    const object = this.objects.get(pathname);
    return object ? { size: object.bytes.byteLength, contentType: object.contentType } : null;
  }

  async open(pathname: string) {
    const object = this.objects.get(pathname);
    if (!object) return null;
    const chunkSize = 64 * 1024;
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (offset >= object.bytes.byteLength) return controller.close();
        const chunk = object.bytes.subarray(offset, offset + chunkSize);
        offset += chunk.byteLength;
        this.bytesRead += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
  }

  async remove(pathnames: string[]) {
    if (this.failRemove) throw new Error('storage unavailable');
    for (const pathname of pathnames) {
      this.objects.delete(pathname);
      this.removed.push(pathname);
    }
  }

  async listOlderThan(prefix: string, before: Date) {
    return [...this.objects.entries()]
      .filter(([pathname, o]) => pathname.startsWith(prefix) && o.uploadedAt < before)
      .map(([pathname]) => pathname);
  }
}

/** 画像検査のテスト用。バイト列の先頭で形式を判定し、寸法は指定値を返す。 */
export class FakeImageInspector implements ImageInspector {
  size = { width: 100, height: 80 };

  async inspect(bytes: Uint8Array) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { format: 'jpeg', ...this.size };
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { format: 'png', ...this.size };
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return { format: 'gif', ...this.size };
    return null;
  }
}

export const JPEG_BYTES = (size = 100) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};
export const PNG_BYTES = (size = 100) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  return bytes;
};
export const GIF_BYTES = (size = 100) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x47, 0x49, 0x46]);
  return bytes;
};
