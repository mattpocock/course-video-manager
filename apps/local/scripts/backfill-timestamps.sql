-- Check for null values first
SELECT id, created_at FROM "course-video-manager_video" WHERE "created_at" IS NULL;
SELECT id, created_at FROM "course-video-manager_clip" WHERE "created_at" IS NULL;

-- Backfill null createdAt values before adding NOT NULL constraint
UPDATE "course-video-manager_video"
SET "created_at" = CURRENT_TIMESTAMP
WHERE "created_at" IS NULL;

UPDATE "course-video-manager_clip"
SET "created_at" = CURRENT_TIMESTAMP
WHERE "created_at" IS NULL;
