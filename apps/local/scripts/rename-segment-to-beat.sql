-- Migration: Rename segment table to beat
-- Run this in a transaction before updating the Drizzle schema and running db:push
--
-- This migration renames the table in-place without data loss.
-- After running this, update the Drizzle schema and run `drizzle-kit push` to sync
-- any constraint/index names.

BEGIN;

-- Rename table
ALTER TABLE "course-video-manager_segment" RENAME TO "course-video-manager_beat";

COMMIT;
