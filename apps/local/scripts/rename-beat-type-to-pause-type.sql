-- Migration: Rename clip beat_type column to pause_type
-- Run this in a transaction before updating the Drizzle schema and running db:push
--
-- This migration renames the column in-place without data loss.
-- After running this, update the Drizzle schema and run `drizzle-kit push` to sync
-- any constraint/index names.

BEGIN;

-- Rename column
ALTER TABLE "course-video-manager_clip" RENAME COLUMN "beat_type" TO "pause_type";

COMMIT;
