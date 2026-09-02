-- User-set script name. NULL = display falls back to the source topic title
-- (muse idea storyAngle / custom topic text), so old scripts need no backfill.
ALTER TABLE "poet_scripts" ADD COLUMN "name" text;
