CREATE TABLE "course-video-manager_clip_mockup_chapter" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"order" varchar(255) COLLATE "C" NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup_chapter" ADD CONSTRAINT "course-video-manager_clip_mockup_chapter_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_mockup_chapter_video_id_idx" ON "course-video-manager_clip_mockup_chapter" USING btree ("video_id");