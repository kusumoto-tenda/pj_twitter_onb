-- お気に入り（自分専用の保存）。いいね（相手からも見える反応）とは別のテーブル。
-- 利用者・投稿ごとに1行。利用者の退会・投稿の削除で一緒に消える。
CREATE TABLE twitter.favorites (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES twitter.users (id) ON DELETE CASCADE,
  tweet_id UUID NOT NULL REFERENCES twitter.tweets (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT favorites_user_tweet_unique UNIQUE (user_id, tweet_id)
);
-- 本人の一覧（保存日時の降順）と、投稿の削除時のCASCADEに使う。
CREATE INDEX favorites_user_created_idx ON twitter.favorites (user_id, created_at DESC, id DESC);
CREATE INDEX favorites_tweet_idx ON twitter.favorites (tweet_id);
