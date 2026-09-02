-- NULL = display falls back to the source topic title, so old rows need no backfill.
ALTER TABLE "poet_scripts" ADD COLUMN "name" text;
