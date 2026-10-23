/** 登録フォームから受け取る入力。bioは任意。 */
export type CreateAccountInput = {
  name: string;
  displayId: string;
  bio?: string;
  password: string;
};

/** 検証・整形済みの入力。 */
export type ValidAccountInput = {
  name: string;
  displayId: string;
  bio: string;
  password: string;
};

export type AccountField = keyof ValidAccountInput;
export type FieldErrors = Partial<Record<AccountField, string[]>>;

/** 外部に公開してよいユーザー情報。パスワード関連の値を含めない。 */
export type AccountProfile = {
  id: string;
  name: string;
  displayId: string;
  bio: string;
  createdAt: Date;
};

/** 永続化するアカウント。 */
export type StoredAccount = AccountProfile & { passwordHash: string };

/** 保存用アカウントから公開フィールドだけを明示的に取り出す。 */
export function toAccountProfile(account: StoredAccount): AccountProfile {
  return {
    id: account.id,
    name: account.name,
    displayId: account.displayId,
    bio: account.bio,
    createdAt: account.createdAt,
  };
}
