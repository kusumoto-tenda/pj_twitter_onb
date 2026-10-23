-- タイムライン用の投稿・フォロー・リツイート。
-- ON DELETE CASCADE は関連行の整合性を保つためのもので、削除機能そのものではない。

-- テキスト投稿。画像投稿を追加する際は、本文1文字以上の制約を画像との組み合わせに合わせて見直す。
CREATE TABLE twitter.tweets (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES twitter.users (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT tweets_content_length CHECK (char_length(content) BETWEEN 1 AND 280)
);
CREATE INDEX tweets_created_at_idx ON twitter.tweets (created_at DESC, id DESC);
CREATE INDEX tweets_owner_created_at_idx ON twitter.tweets (owner_id, created_at DESC, id DESC);

-- follower_id が follow_id をフォローする。
CREATE TABLE twitter.follows (
  id UUID PRIMARY KEY,
  follow_id UUID NOT NULL REFERENCES twitter.users (id) ON DELETE CASCADE,
  follower_id UUID NOT NULL REFERENCES twitter.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  -- follower_id からの検索にもこの一意インデックスを使う。
  CONSTRAINT follows_follower_follow_unique UNIQUE (follower_id, follow_id),
  CONSTRAINT follows_no_self_follow CHECK (follower_id <> follow_id)
);
CREATE INDEX follows_follow_id_idx ON twitter.follows (follow_id);

CREATE TABLE twitter.retweets (
  id UUID PRIMARY KEY,
  executor_id UUID NOT NULL REFERENCES twitter.users (id) ON DELETE CASCADE,
  tweet_id UUID NOT NULL REFERENCES twitter.tweets (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT retweets_executor_tweet_unique UNIQUE (executor_id, tweet_id)
);
CREATE INDEX retweets_created_at_idx ON twitter.retweets (created_at DESC, id DESC);
CREATE INDEX retweets_executor_created_at_idx ON twitter.retweets (executor_id, created_at DESC, id DESC);
CREATE INDEX retweets_tweet_id_idx ON twitter.retweets (tweet_id);
