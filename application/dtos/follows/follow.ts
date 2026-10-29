/** フォローの登録・解除の結果。 */
export type SetFollowResult =
  | { ok: true; active: boolean }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'SESSION_CHANGED' | 'INVALID_REQUEST' | 'SELF_FOLLOW' | 'NOT_FOUND' | 'UNAVAILABLE';
    };
