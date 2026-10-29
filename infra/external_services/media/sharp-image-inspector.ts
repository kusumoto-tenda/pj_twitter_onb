import sharp from 'sharp';
import type { ImageInspector } from '@/domain/external_service_ifs/media/image-inspector';
import { MAX_IMAGE_PIXELS } from '@/domain/value_objects/tweets/tweet-validation';

/**
 * sharpで画像を調べる。ヘッダーから形式と寸法を読み、画素数が上限以内のときだけ
 * 実際にデコードして壊れていないことを確かめる（上限を超える画像はデコードしない）。
 */
export class SharpImageInspector implements ImageInspector {
  async inspect(bytes: Uint8Array) {
    try {
      const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const meta = await sharp(input, { limitInputPixels: false }).metadata();
      if (!meta.format || !meta.width || !meta.height) return null;
      const size = { format: meta.format, width: meta.width, height: meta.height };
      if (meta.width * meta.height > MAX_IMAGE_PIXELS) return size;
      // 全体をデコードし、途中で壊れている画像を拒否する（小さく縮めて資源使用量を抑える）。
      await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
        .resize(16, 16, { fit: 'inside' })
        .raw()
        .toBuffer();
      return size;
    } catch {
      return null;
    }
  }
}
