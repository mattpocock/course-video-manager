-- Migration: Rename clip_section table to chapter
-- Run this in a transaction before updating the Drizzle schema and running db:push
--
-- This migration renames the table in-place without data loss.
-- After running this, update the Drizzle schema and run `drizzle-kit push` to sync
-- any constraint/index names.

BEGIN;

-- Rename table
ALTER TABLE "course-video-manager_clip_section" RENAME TO "course-video-manager_chapter";

COMMIT;
