CREATE TABLE "course-video-manager_clip_web_link" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"clip_id" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_web_link" ADD CONSTRAINT "course-video-manager_clip_web_link_clip_id_course-video-manager_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."course-video-manager_clip"("id") ON DELETE cascade ON UPDATE no action;