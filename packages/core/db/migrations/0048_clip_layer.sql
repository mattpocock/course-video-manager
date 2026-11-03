CREATE TABLE "course-video-manager_clip_layer" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"clip_id" varchar(255) NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"footage_path" text,
	"footage_start" double precision,
	"session_file" text,
	"crop_x" double precision,
	"crop_y" double precision,
	"crop_w" double precision,
	"crop_h" double precision,
	"place_x" integer,
	"place_y" integer,
	"place_w" integer,
	"place_h" integer,
	"volume" double precision NOT NULL,
	"span_at" double precision,
	"span_duration" double precision,
	CONSTRAINT "clip_layer_kind_valid" CHECK ("course-video-manager_clip_layer"."kind" IN ('scene', 'footage')),
	CONSTRAINT "clip_layer_session_file_valid" CHECK ("course-video-manager_clip_layer"."session_file" IS NULL OR "course-video-manager_clip_layer"."session_file" IN ('camera', 'screen'))
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_clip_layer" ADD CONSTRAINT "course-video-manager_clip_layer_clip_id_course-video-manager_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."course-video-manager_clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clip_layer_clip_position_uniq" ON "course-video-manager_clip_layer" USING btree ("clip_id","position");