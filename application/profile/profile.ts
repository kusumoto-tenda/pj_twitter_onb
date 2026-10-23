import type { TimelinePerson } from '../timeline/timeline';

/** 画面に出してよい利用者の公開情報。タイムラインと同じ形。 */
export type PublicPerson = TimelinePerson;

export type ProfileSummary = PublicPerson & {
  bio: string;
  /** 利用開始日時（UTC、小数秒6桁）。 */
  createdAt: string;
  /** 対象者がフォローしている人数。 */
  followingCount: number;
  /** 対象者をフォローしている人数。 */
  followerCount: number;
  /** ログイン中の閲覧者が対象者をフォローしているか。 */
  followedByViewer: boolean;
};

export type ProfileTab = 'tweets' | 'retweets' | 'following' | 'followers';
export type ActivityTab = Extract<ProfileTab, 'tweets' | 'retweets'>;
export type ConnectionDirection = Extract<ProfileTab, 'following' | 'followers'>;

/** フォロー関係一覧の順番キー。createdAtはDB精度を保つUTC文字列。 */
export type ConnectionCursor = { createdAt: string; relationId: string };

export type ConnectionPage = { items: PublicPerson[]; nextCursor: ConnectionCursor | null };

export const PROFILE_PAGE_SIZE = 20;
