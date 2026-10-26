/** 現在のブラウザのセッションを終了し、終了を確認できた場合にtrueを返す。 */
export interface SessionTerminator {
  end(): Promise<boolean>;
}
