CREATE TABLE IF NOT EXISTS video_chapters (
  video_id         TEXT PRIMARY KEY,
  chapters         JSONB,
  title            TEXT,
  duration_seconds INTEGER,
  status           TEXT NOT NULL DEFAULT 'ready'
                   CHECK (status IN ('generating', 'ready', 'api_failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS regeneration_staging (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        TEXT NOT NULL,
  video_id         TEXT NOT NULL,
  chapters         JSONB NOT NULL,
  title            TEXT,
  duration_seconds INTEGER,
  reason_type      TEXT NOT NULL CHECK (reason_type IN ('issue', 'nuanced')),
  reason_text      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'promoted', 'discarded', 'superseded')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_staging_client_video
  ON regeneration_staging (client_id, video_id);

CREATE TABLE IF NOT EXISTS regenerate_quota (
  client_id        TEXT NOT NULL,
  quota_date       DATE NOT NULL,
  successful_count INTEGER NOT NULL DEFAULT 0,
  denied_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, quota_date)
);

CREATE TABLE IF NOT EXISTS user_video_cooldown (
  client_id  TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_id, video_id)
);
