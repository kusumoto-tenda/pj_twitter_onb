'use client';

import type { EditableTweet } from '@/domain/repository_ifs/tweet-editor';

/**
 * 編集中の投稿に添付済みの画像。解除はフォーム内の変更だけで、保存するまで元の投稿は変えない。
 * 解除した画像を戻すには、保存せずに閉じて開き直す（並べ替えはしない）。
 */
export function EditTweetImages({
  images,
  keepImageIds,
  disabled,
  onRemove,
}: {
  images: EditableTweet['images'];
  keepImageIds: string[];
  disabled: boolean;
  onRemove: (imageId: string) => void;
}) {
  const kept = images.filter((image) => keepImageIds.includes(image.id));
  if (kept.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label="添付済みの画像">
      {kept.map((image, index) => (
        <li key={image.id} className="overflow-hidden rounded-lg border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/media/${image.id}`}
            alt={`添付済みの画像${index + 1}`}
            width={image.width}
            height={image.height}
            className="h-28 w-full bg-gray-100 object-cover"
          />
          <div className="flex justify-end p-1 text-xs">
            <button
              type="button"
              onClick={() => onRemove(image.id)}
              disabled={disabled}
              aria-label={`添付済みの画像${index + 1}を解除`}
              className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-50"
            >
              解除
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
