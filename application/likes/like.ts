/** いいねの登録・解除の結果。成功時のcountは操作後の元投稿の公開いいね件数。 */
export type SetLikeResult =
  | { ok: true; active: boolean; count: number }
  | { ok: false; code: 'UNAUTHENTICATED' | 'SESSION_CHANGED' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'UNAVAILABLE' };
