-- Adds status + nullable chapters for DBs created from older 001_initial.sql.
ALTER TABLE video_chapters
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE video_chapters DROP CONSTRAINT IF EXISTS video_chapters_status_check;
ALTER TABLE video_chapters
  ADD CONSTRAINT video_chapters_status_check
  CHECK (status IN ('generating', 'ready', 'api_failed'));

ALTER TABLE video_chapters ALTER COLUMN chapters DROP NOT NULL;

UPDATE video_chapters
SET status = 'ready'
WHERE status IS NULL OR (chapters IS NOT NULL AND status = 'ready');
