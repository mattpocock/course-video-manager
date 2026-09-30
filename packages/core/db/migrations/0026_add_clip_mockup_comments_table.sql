CREATE TABLE "course-video-manager_clip_mockup_comment" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"clip_mockup_id" varchar(255),
	"clip_mockup_chapter_id" varchar(255),
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "clip_mockup_comment_one_parent" CHECK (("course-video-manager_clip_mockup_comment"."clip_mockup_id" IS NULL) <> ("course-video-manager_clip_mockup_comment"."clip_mockup_chapter_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup_comment" ADD CONSTRAINT "course-video-manager_clip_mockup_comment_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup_comment" ADD CONSTRAINT "course-video-manager_clip_mockup_comment_clip_mockup_id_course-video-manager_clip_mockup_id_fk" FOREIGN KEY ("clip_mockup_id") REFERENCES "public"."course-video-manager_clip_mockup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_mockup_comment" ADD CONSTRAINT "course-video-manager_clip_mockup_comment_clip_mockup_chapter_id_course-video-manager_clip_mockup_chapter_id_fk" FOREIGN KEY ("clip_mockup_chapter_id") REFERENCES "public"."course-video-manager_clip_mockup_chapter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_mockup_comment_video_id_idx" ON "course-video-manager_clip_mockup_comment" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "clip_mockup_comment_clip_mockup_id_idx" ON "course-video-manager_clip_mockup_comment" USING btree ("clip_mockup_id");--> statement-breakpoint
CREATE INDEX "clip_mockup_comment_clip_mockup_chapter_id_idx" ON "course-video-manager_clip_mockup_comment" USING btree ("clip_mockup_chapter_id");