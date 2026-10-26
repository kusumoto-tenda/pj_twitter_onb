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
