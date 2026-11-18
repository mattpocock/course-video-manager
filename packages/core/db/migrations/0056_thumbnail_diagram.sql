ALTER TABLE "course-video-manager_thumbnail" ADD COLUMN "thumbnail_diagram" jsonb;--> statement-breakpoint
ALTER TABLE "course-video-manager_thumbnail" ADD COLUMN "diagram_search_text" text;--> statement-breakpoint
ALTER TABLE "course-video-manager_thumbnail" ADD COLUMN "diagram_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "course-video-manager_thumbnail" ADD COLUMN "archived_at" timestamp with time zone;