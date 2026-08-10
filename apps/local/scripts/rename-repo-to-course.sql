-- Migration: Rename repo/repo_version tables to course/course_version
-- Run this in a transaction before updating the Drizzle schema and running db:push
--
-- This migration renames tables and columns in-place without data loss.
-- After running this, update the Drizzle schema and run `drizzle-kit push` to sync
-- any constraint/index names.

BEGIN;

-- 1. Rename tables
ALTER TABLE "course-video-manager_repo" RENAME TO "course-video-manager_course";
ALTER TABLE "course-video-manager_repo_version" RENAME TO "course-video-manager_course_version";

-- 2. Rename columns
-- course table: file_path -> repo_path (clarifies the Course -> CourseRepo relationship)
ALTER TABLE "course-video-manager_course" RENAME COLUMN "file_path" TO "repo_path";

-- course_version table: repo_id -> course_id
ALTER TABLE "course-video-manager_course_version" RENAME COLUMN "repo_id" TO "course_id";

-- section table: repo_version_id -> course_version_id
ALTER TABLE "course-video-manager_section" RENAME COLUMN "repo_version_id" TO "course_version_id";

COMMIT;
