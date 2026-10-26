/** 登録直後の成功通知を次の画面へ渡す表示専用Cookie。認証・権限判定には使わない。 */
export const FLASH_COOKIE = 'flash';
export const ACCOUNT_CREATED_FLASH = 'account-created';
export const FLASH_MAX_AGE_SECONDS = 60;

export const ACCOUNT_CREATED_MESSAGE = 'アカウントを作成しました';
export const ACCOUNT_CREATE_FAILED_MESSAGE = 'アカウントの作成に失敗しました';

/** プロフィール更新後の通知用Cookie。登録用の FLASH_COOKIE とは分け、上書き・流用しない。 */
export const PROFILE_UPDATED_COOKIE = 'flash_profile';
export const PROFILE_UPDATED_FLASH = 'profile-updated';
export const PROFILE_UPDATED_MESSAGE = 'プロフィールを更新しました';

/**
 * アカウント削除後にログイン画面で表示する通知用Cookie。他の通知Cookieとは分ける。
 * deleted: 削除成功（3秒のToast）
 * signout-failed: 削除済みだがログアウト処理を完了できなかった（固定表示）
 * account-missing: 削除しようとした時点で対象を確認できなかった（固定表示）
 */
export const ACCOUNT_DELETED_COOKIE = 'flash_account';
export const ACCOUNT_DELETED_FLASHES = ['deleted', 'signout-failed', 'account-missing'] as const;
export type AccountDeletedFlash = (typeof ACCOUNT_DELETED_FLASHES)[number];
export const ACCOUNT_DELETED_MESSAGES: Record<AccountDeletedFlash, string> = {
  deleted: 'アカウントを削除しました',
  'signout-failed': 'アカウントは削除済みですが、ログアウト処理を完了できませんでした',
  'account-missing': 'アカウントを確認できません。再度ログインしてください',
};

/** 投稿後・未ログインでの投稿時に表示する通知用Cookie。他の通知Cookieとは分ける。 */
export const TWEET_FLASH_COOKIE = 'flash_tweet';
export const TWEET_FLASHES = ['posted', 'login-required'] as const;
export type TweetFlashValue = (typeof TWEET_FLASHES)[number];
export const TWEET_FLASH_MESSAGES: Record<TweetFlashValue, string> = {
  posted: 'ツイートしました',
  'login-required': 'ツイートするにはログインしてください',
};
export const TWEET_FAILED_MESSAGE = 'ツイートに失敗しました';
