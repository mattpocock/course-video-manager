-- One-off script to seed lineageId on all pre-existing sections, lessons, and
-- videos. Each row gets a fresh UUID — no historical chain-walking backfill.
-- The contract only needs stability from first-emit onward.
--
-- Run once against the live DB, then `drizzle-kit push` to sync constraints.
-- Part of #1126

BEGIN;

UPDATE "course-video-manager_section"
   SET lineage_id = gen_random_uuid()
 WHERE lineage_id IS NULL;

UPDATE "course-video-manager_lesson"
   SET lineage_id = gen_random_uuid()
 WHERE lineage_id IS NULL;

UPDATE "course-video-manager_video"
   SET lineage_id = gen_random_uuid()
 WHERE lineage_id IS NULL;

COMMIT;
