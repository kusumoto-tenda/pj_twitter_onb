-- いいね（相手からも見える反応）。お気に入り（自分専用の保存）とは別のテーブル。
-- 利用者・元投稿ごとに1行。いいねした人の退会・投稿の削除（作者の退会を含む）で一緒に消える。
CREATE TABLE twitter.likes (
  id UUID PRIMARY KEY,
  executor_id UUID NOT NULL REFERENCES twitter.users (id) ON DELETE CASCADE,
  tweet_id UUID NOT NULL REFERENCES twitter.tweets (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT likes_executor_tweet_unique UNIQUE (executor_id, tweet_id)
);
-- 公開いいね一覧（いいねした日時の降順）に使う。
CREATE INDEX likes_executor_created_idx ON twitter.likes (executor_id, created_at DESC, id DESC);
-- 投稿ごとの件数と、投稿の削除時のCASCADEに使う。
CREATE INDEX likes_tweet_idx ON twitter.likes (tweet_id);
