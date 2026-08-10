ALTER TABLE "course-video-manager_course_version" ADD COLUMN "commit_state" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
UPDATE "course-video-manager_course_version" cv SET "commit_state" = 'published'
WHERE cv."id" <> (
  SELECT cv2."id" FROM "course-video-manager_course_version" cv2
  WHERE cv2."course_id" = cv."course_id"
  ORDER BY cv2."created_at" DESC, cv2."id" DESC
  LIMIT 1
);
