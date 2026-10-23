/** タイムラインに表示する利用者の公開情報。 */
export type TimelinePerson = { id: string; name: string; displayId: string };

export type TimelineEventKind = 'tweet' | 'retweet';

/**
 * 一覧上の順番を表すキー。eventAtはDB精度（マイクロ秒）を保つUTC文字列で、
 * Dateへ変換せずにページ境界の比較へ使う。
 */
export type TimelineCursor = {
  eventAt: string;
  kind: TimelineEventKind;
  eventId: string;
};

export type TimelineItem = {
  key: TimelineCursor;
  tweet: {
    id: string;
    content: string;
    author: TimelinePerson;
    createdAt: string;
  };
  /** リツイートの場合の実行者。通常投稿はnull。 */
  retweetedBy: TimelinePerson | null;
};

export type TimelinePage = { items: TimelineItem[]; nextCursor: TimelineCursor | null };

export const TIMELINE_PAGE_SIZE = 20;
