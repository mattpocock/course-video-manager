CREATE TABLE "course-video-manager_chat_highlight" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255),
	"recording_session_id" varchar(255) NOT NULL,
	"broadcast_id" text NOT NULL,
	"message_id" text NOT NULL,
	"author" text NOT NULL,
	"text" text NOT NULL,
	"shown_at_ms" double precision NOT NULL,
	"hidden_at_ms" double precision
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_chat_highlight" ADD CONSTRAINT "course-video-manager_chat_highlight_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_chat_highlight" ADD CONSTRAINT "course-video-manager_chat_highlight_recording_session_id_course-video-manager_recording_session_id_fk" FOREIGN KEY ("recording_session_id") REFERENCES "public"."course-video-manager_recording_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_highlight_session_shown_idx" ON "course-video-manager_chat_highlight" USING btree ("recording_session_id","shown_at_ms");