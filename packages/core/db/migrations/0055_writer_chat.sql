CREATE TABLE "course-video-manager_writer_chat" (
	"video_id" varchar(255) NOT NULL,
	"field_id" text NOT NULL,
	"mode" text NOT NULL,
	"messages" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "course-video-manager_writer_chat_video_id_field_id_mode_pk" PRIMARY KEY("video_id","field_id","mode")
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_writer_chat" ADD CONSTRAINT "course-video-manager_writer_chat_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;