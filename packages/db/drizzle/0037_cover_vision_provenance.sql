ALTER TABLE clerk_videos ADD COLUMN IF NOT EXISTS cover_vision_at timestamptz;

-- Backfill: a diagnosis or title suggestion could only have been written by a vision pass.
UPDATE clerk_videos
SET cover_vision_at = COALESCE(analyzed_at, now())
WHERE cover_vision_at IS NULL
  AND (cover_diagnosis IS NOT NULL OR cover_title_suggestions IS NOT NULL);

-- The multi-image path emits this phrase and returns no title suggestions, so these rows
-- carry a real read the old inferred gate could not see.
UPDATE clerk_videos
SET cover_vision_at = COALESCE(analyzed_at, now())
WHERE cover_vision_at IS NULL
  AND (thumbnail_description LIKE '%整组图片%' OR thumbnail_description LIKE '%whole set%');
