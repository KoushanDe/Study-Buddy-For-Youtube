CREATE TABLE IF NOT EXISTS user_video_chapters (
  client_id        TEXT NOT NULL,
  video_id         TEXT NOT NULL,
  chapters         JSONB NOT NULL,
  reason_text      TEXT,
  title            TEXT,
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, video_id)
);
