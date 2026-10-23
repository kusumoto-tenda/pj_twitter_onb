-- Twitter用のユーザー。教材用の public.users とは別のschemaに置く。
CREATE TABLE twitter.users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  display_id TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT users_name_length CHECK (char_length(name) BETWEEN 1 AND 50),
  CONSTRAINT users_display_id_length CHECK (char_length(display_id) BETWEEN 5 AND 15),
  CONSTRAINT users_display_id_format CHECK (display_id ~ '^[A-Za-z0-9_]+$'),
  CONSTRAINT users_bio_length CHECK (char_length(bio) <= 160)
);

-- ユーザーIDは大文字小文字を区別せず一意にする。表示用の綴りは display_id に保持する。
CREATE UNIQUE INDEX users_display_id_ci_unique ON twitter.users (lower(display_id));
