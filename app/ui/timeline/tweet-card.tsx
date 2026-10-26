import Link from 'next/link';
import type { TimelineImage, TimelineItem } from '@/application/timeline/timeline';
import { profileHref } from '@/app/lib/profile-query';

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** サーバーとクライアントで同じ表示になるよう、固定形式 YYYY/MM/DD HH:mm（Asia/Tokyo）で表す。 */
export function formatTimelineDate(utc: string): string {
  // マイクロ秒の文字列はDateが解釈できる精度（ミリ秒）に切り詰めて表示だけに使う。
  const date = new Date(`${utc.slice(0, 23)}Z`);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateFormatter.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

export function TweetCard({ item }: { item: TimelineItem }) {
  const { tweet, retweetedBy } = item;
  return (
    <article className="border-b border-gray-200 px-4 py-3">
      {retweetedBy && (
        <p className="mb-1 text-sm font-bold text-gray-500">
          <Link
            href={profileHref({ displayId: retweetedBy.displayId, tab: 'tweets' })}
            className="hover:underline"
          >
            {retweetedBy.name}
          </Link>
          さんがリツイート
        </p>
      )}
      <header className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <Link
          href={profileHref({ displayId: tweet.author.displayId, tab: 'tweets' })}
          className="font-bold text-gray-900 hover:underline"
        >
          {tweet.author.name}
        </Link>
        <span className="text-gray-500">@{tweet.author.displayId}</span>
        <time dateTime={tweet.createdAt} className="text-gray-500">
          {formatTimelineDate(tweet.createdAt)}
        </time>
      </header>
      {/* 本文はプレーンテキスト。改行を保ち、長いURLなども折り返す。画像だけの投稿では段落を出さない。 */}
      {(tweet.content.trim() !== '' || tweet.images.length === 0) && (
        <p data-content className="mt-1 whitespace-pre-wrap text-base text-gray-900 [overflow-wrap:anywhere]">
          {tweet.content}
        </p>
      )}
      {tweet.images.length > 0 && <TweetImages images={tweet.images} />}
    </article>
  );
}

/**
 * 添付画像。投稿済みの画像はアプリの /media から配信する（画像最適化のキャッシュを通さない）。
 */
function TweetImages({ images }: { images: TimelineImage[] }) {
  const ordered = [...images].sort((a, b) => a.position - b.position);
  return (
    <div className={`mt-2 grid gap-1 ${ordered.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {ordered.map((image, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={image.id}
          src={`/media/${image.id}`}
          alt={`添付画像${index + 1}`}
          width={image.width}
          height={image.height}
          loading="lazy"
          className="h-auto max-h-80 w-full rounded-lg border border-gray-200 bg-gray-100 object-contain"
        />
      ))}
    </div>
  );
}
