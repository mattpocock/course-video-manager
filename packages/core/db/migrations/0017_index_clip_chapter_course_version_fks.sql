CREATE INDEX "chapter_video_id_idx" ON "course-video-manager_chapter" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "clip_video_id_idx" ON "course-video-manager_clip" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "course_version_course_id_idx" ON "course-video-manager_course_version" USING btree ("course_id");