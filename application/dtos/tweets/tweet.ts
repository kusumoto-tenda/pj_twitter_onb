import type { TweetFieldErrors } from '@/domain/value_objects/tweets/tweet-validation';

export type CreateTweetResult =
  | { ok: true; tweetId: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'FORBIDDEN'
        | 'DRAFT_EXPIRED'
        | 'UPLOAD_NOT_READY'
        | 'CONFLICT'
        | 'UNAVAILABLE';
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: TweetFieldErrors };
