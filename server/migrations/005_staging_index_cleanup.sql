DROP INDEX IF EXISTS idx_staging_client_video;
DROP INDEX IF EXISTS idx_regeneration_staging_client_video;

CREATE INDEX IF NOT EXISTS idx_staging_client_video
  ON regeneration_staging (client_id, video_id);
