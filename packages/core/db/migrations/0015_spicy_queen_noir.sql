CREATE TABLE "course-video-manager_clip_transcript_word" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"clip_id" varchar(255) NOT NULL,
	"start" double precision NOT NULL,
	"end" double precision NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_transcript_word" ADD CONSTRAINT "course-video-manager_clip_transcript_word_clip_id_course-video-manager_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."course-video-manager_clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_transcript_word_clip_id_idx" ON "course-video-manager_clip_transcript_word" USING btree ("clip_id");