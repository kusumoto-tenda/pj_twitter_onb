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

/** 投稿に添付された画像。表示URLは `/media/{id}`。保存先の情報は含めない。 */
export type TimelineImage = { id: string; position: number; width: number; height: number };

export type TimelineItem = {
  key: TimelineCursor;
  tweet: {
    id: string;
    content: string;
    author: TimelinePerson;
    createdAt: string;
    /** 表示順（position順）。画像なしは空配列。 */
    images: TimelineImage[];
    /** 閲覧者本人がこの元投稿をお気に入りに保存しているか。未ログインはfalse。 */
    favoritedByViewer: boolean;
    /** 閲覧者本人がこの元投稿にいいねしているか。未ログインはfalse。 */
    likedByViewer: boolean;
    /** この元投稿の公開いいね件数。 */
    likeCount: number;
    /** 閲覧者本人がこの元投稿をリツイートしているか。未ログインはfalse。 */
    retweetedByViewer: boolean;
    /** この元投稿の公開リツイート件数。 */
    retweetCount: number;
  };
  /** リツイートの場合の実行者。通常投稿はnull。 */
  retweetedBy: TimelinePerson | null;
};

export type TimelinePage = { items: TimelineItem[]; nextCursor: TimelineCursor | null };

export const TIMELINE_PAGE_SIZE = 20;
