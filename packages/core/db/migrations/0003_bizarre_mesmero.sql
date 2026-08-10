CREATE TABLE "course-video-manager_video_post" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"platform" text NOT NULL,
	"remote_id" text,
	"remote_url" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_video" ADD COLUMN "format" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "course-video-manager_video_post" ADD CONSTRAINT "course-video-manager_video_post_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;