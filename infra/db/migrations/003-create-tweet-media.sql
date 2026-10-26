-- ツイートの添付画像と下書き。002は書き換えず、本文の制約を「画像があれば空でもよい」に変える。

-- 本文は0〜280文字。空（空白だけを含む）の場合は画像が必要で、それは下の遅延制約で確認する。
ALTER TABLE twitter.tweets DROP CONSTRAINT tweets_content_length;
ALTER TABLE twitter.tweets ADD CONSTRAINT tweets_content_length CHECK (char_length(content) <= 280);

-- 投稿ダイアログの下書き。draftIdを投稿UUIDとして使う。所有者を削除しても回収のため行は残す。
CREATE TABLE twitter.tweet_drafts (
  id UUID PRIMARY KEY,
  owner_id UUID REFERENCES twitter.users (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'published', 'discarded')),
  expires_at TIMESTAMPTZ NOT NULL,
  fingerprint TEXT,
  published_tweet_id UUID REFERENCES twitter.tweets (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX tweet_drafts_open_expires_idx ON twitter.tweet_drafts (expires_at) WHERE status = 'open';

-- 画像1枚ごとの予約。実体の削除が終わるまで、所有者を削除しても行を残す。
CREATE TABLE twitter.media_uploads (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES twitter.tweet_drafts (id),
  owner_id UUID REFERENCES twitter.users (id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'verified', 'attached', 'discarded', 'deleting')),
  size_bytes INTEGER,
  content_type TEXT,
  width INTEGER,
  height INTEGER,
  token_valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX media_uploads_draft_status_idx ON twitter.media_uploads (draft_id, status);

-- 投稿に添付された画像（最大4枚。positionが表示順）。
CREATE TABLE twitter.images (
  id UUID PRIMARY KEY,
  tweet_id UUID NOT NULL REFERENCES twitter.tweets (id) ON DELETE CASCADE,
  upload_id UUID NOT NULL UNIQUE REFERENCES twitter.media_uploads (id),
  storage_key TEXT NOT NULL,
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 3),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  CONSTRAINT images_tweet_position_unique UNIQUE (tweet_id, position)
);

-- 実体の削除予約。利用者の削除でも消えない。
CREATE TABLE twitter.media_delete_jobs (
  storage_key TEXT PRIMARY KEY,
  not_before TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_delete_jobs_due_idx ON twitter.media_delete_jobs (next_attempt_at);

-- 公開投稿は「空白だけでない本文」または「1枚以上の画像」を持つ。トランザクションの最後に確認する。
-- 投稿自体が削除済み（アカウント削除のCASCADEなど）ならエラーにしない。
CREATE FUNCTION twitter.check_tweet_has_content() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target UUID;
BEGIN
  IF TG_TABLE_NAME = 'tweets' THEN
    target := NEW.id;
  ELSE
    target := OLD.tweet_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM twitter.tweets t
    WHERE t.id = target
      AND t.content ~ '^[[:space:]　]*$'
      AND NOT EXISTS (SELECT 1 FROM twitter.images i WHERE i.tweet_id = t.id)
  ) THEN
    RAISE EXCEPTION 'tweet % must have content or images', target USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tweets_require_content
  AFTER INSERT OR UPDATE ON twitter.tweets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION twitter.check_tweet_has_content();

CREATE CONSTRAINT TRIGGER images_keep_tweet_content
  AFTER DELETE OR UPDATE ON twitter.images
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION twitter.check_tweet_has_content();

-- 画像行が消えたら（投稿・アカウントの削除を含む）、同じトランザクションで実体の削除を予約する。
CREATE FUNCTION twitter.schedule_image_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO twitter.media_delete_jobs (storage_key, not_before, next_attempt_at)
  VALUES (OLD.storage_key, now(), now())
  ON CONFLICT (storage_key) DO NOTHING;
  UPDATE twitter.media_uploads SET status = 'deleting' WHERE id = OLD.upload_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER images_schedule_delete
  AFTER DELETE ON twitter.images
  FOR EACH ROW EXECUTE FUNCTION twitter.schedule_image_delete();
