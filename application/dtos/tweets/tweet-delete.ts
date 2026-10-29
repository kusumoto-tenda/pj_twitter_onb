export type BeginTweetDeleteResult =
  | { ok: true; value: { tweetId: string; actorId: string; content: string } }
  | { ok: false; code: 'UNAUTHENTICATED' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN' | 'UNAVAILABLE' };

export type DeleteTweetErrorCode =
  | 'UNAUTHENTICATED'
  | 'SESSION_CHANGED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAVAILABLE';

export type DeleteTweetResult = { ok: true } | { ok: false; code: DeleteTweetErrorCode };
