import type { TweetFieldErrors } from '@/domain/value_objects/tweets/tweet-validation';
import type { EditableTweet } from '@/domain/repository_ifs/tweet-editor';

export type BeginTweetEditResult =
  | { ok: true; value: EditableTweet }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NOT_FOUND' | 'FORBIDDEN' | 'UNAVAILABLE' };

export type UpdateTweetResult =
  | { ok: true; tweetId: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'DRAFT_EXPIRED'
        | 'CONFLICT'
        | 'UPLOAD_NOT_READY'
        | 'UNAVAILABLE';
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: TweetFieldErrors };
