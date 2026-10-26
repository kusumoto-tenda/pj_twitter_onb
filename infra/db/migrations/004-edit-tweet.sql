-- ツイートの編集。003は書き換えず、版・編集用の下書き・画像位置の遅延制約・削除予約時刻を追加・変更する。

-- 内容が実際に変わったときだけ進める版。編集の競合検出に使う。
ALTER TABLE twitter.tweets ADD COLUMN revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0);

-- 下書きの用途。編集用は対象の投稿と、準備時の版を記録する（対象の削除ではNULLになり得る）。
ALTER TABLE twitter.tweet_drafts
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'create' CHECK (purpose IN ('create', 'edit')),
  ADD COLUMN target_tweet_id UUID REFERENCES twitter.tweets (id) ON DELETE SET NULL,
  ADD COLUMN base_revision BIGINT,
  ADD CONSTRAINT edit_draft_base_revision CHECK (purpose <> 'edit' OR base_revision IS NOT NULL);

-- 保持する画像の位置をまとめて詰めるとき、一時的な重複を許すため遅延可能にする（確定時には一意）。
ALTER TABLE twitter.images DROP CONSTRAINT images_tweet_position_unique;
ALTER TABLE twitter.images ADD CONSTRAINT images_tweet_position_unique
  UNIQUE (tweet_id, position) DEFERRABLE INITIALLY IMMEDIATE;

-- 画像行が消えたときの削除予約は、その画像のトークンの期限以降にする。
-- 有効なトークンで同じパスに実体が作り直される隙間を作らない（アカウント削除経由でも同じ）。
CREATE OR REPLACE FUNCTION twitter.schedule_image_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_at TIMESTAMPTZ;
BEGIN
  SELECT GREATEST(now(), u.token_valid_until) INTO run_at
  FROM twitter.media_uploads u WHERE u.id = OLD.upload_id;
  run_at := COALESCE(run_at, now());
  INSERT INTO twitter.media_delete_jobs (storage_key, not_before, next_attempt_at)
  VALUES (OLD.storage_key, run_at, run_at)
  ON CONFLICT (storage_key) DO UPDATE SET
    not_before = GREATEST(twitter.media_delete_jobs.not_before, EXCLUDED.not_before),
    next_attempt_at = GREATEST(twitter.media_delete_jobs.next_attempt_at, EXCLUDED.next_attempt_at);
  UPDATE twitter.media_uploads SET status = 'deleting' WHERE id = OLD.upload_id;
  RETURN OLD;
END;
$$;
