ALTER TABLE "course-video-manager_overlay" ADD COLUMN "bullets" jsonb;--> statement-breakpoint
ALTER TABLE "course-video-manager_overlay" ADD COLUMN "disable_enter_animation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course-video-manager_overlay" ADD COLUMN "disable_exit_animation" boolean DEFAULT false NOT NULL;