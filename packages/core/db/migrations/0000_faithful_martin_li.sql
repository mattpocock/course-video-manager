CREATE TABLE "course-video-manager_ai_hero_auth" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_beat" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"kind" text DEFAULT 'definition' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"order" varchar(255) COLLATE "C" NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_chapter" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"order" varchar(255) COLLATE "C" NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_clip" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"video_filename" text NOT NULL,
	"source_start_time" double precision NOT NULL,
	"source_end_time" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"order" varchar(255) COLLATE "C" NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"text" text NOT NULL,
	"transcribed_at" timestamp with time zone,
	"scene" varchar(255),
	"profile" varchar(255),
	"pause_type" varchar(255) DEFAULT 'none' NOT NULL,
	"diagram_snapshot_id" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_course_version" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"course_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_course" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"archived" boolean DEFAULT false NOT NULL,
	"memory" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_deliverable" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"date" date NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_deliverable_course" (
	"deliverable_id" varchar(255) NOT NULL,
	"course_id" varchar(255) NOT NULL,
	CONSTRAINT "course-video-manager_deliverable_course_deliverable_id_course_id_pk" PRIMARY KEY("deliverable_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_deliverable_pitch" (
	"deliverable_id" varchar(255) NOT NULL,
	"pitch_id" varchar(255) NOT NULL,
	CONSTRAINT "course-video-manager_deliverable_pitch_deliverable_id_pitch_id_pk" PRIMARY KEY("deliverable_id","pitch_id")
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_diagram_snapshot" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"diagram_id" varchar(255) NOT NULL,
	"scene" jsonb NOT NULL,
	"content_hash" varchar(255) NOT NULL,
	"preserved" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_diagram" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Untitled 1' NOT NULL,
	"head_scene" jsonb,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_lesson" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"section_id" varchar(255) NOT NULL,
	"previous_version_lesson_id" varchar(255),
	"lineage_id" varchar(255) NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" varchar(255),
	"priority" integer DEFAULT 2 NOT NULL,
	"dependencies" text[],
	"authoring_status" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"order" double precision NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_link" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "course-video-manager_link_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_pitch" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"content_plan" text DEFAULT '' NOT NULL,
	"youtube_title" text DEFAULT '' NOT NULL,
	"youtube_thumbnail_description" text DEFAULT '' NOT NULL,
	"newsletter_title" text DEFAULT '' NOT NULL,
	"tweet" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"effort" integer DEFAULT 2 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_section" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"course_version_id" varchar(255) NOT NULL,
	"previous_version_section_id" varchar(255),
	"lineage_id" varchar(255) NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"order" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_thumbnail" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"layers" jsonb NOT NULL,
	"file_path" text,
	"selected_for_upload" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_video" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"lesson_id" varchar(255),
	"pitch_id" varchar(255),
	"lineage_id" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"original_footage_path" text NOT NULL,
	"body" text,
	"video_description" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course-video-manager_youtube_auth" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_beat" ADD CONSTRAINT "course-video-manager_beat_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_chapter" ADD CONSTRAINT "course-video-manager_chapter_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip" ADD CONSTRAINT "course-video-manager_clip_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_clip" ADD CONSTRAINT "course-video-manager_clip_diagram_snapshot_id_course-video-manager_diagram_snapshot_id_fk" FOREIGN KEY ("diagram_snapshot_id") REFERENCES "public"."course-video-manager_diagram_snapshot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_course_version" ADD CONSTRAINT "course-video-manager_course_version_course_id_course-video-manager_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course-video-manager_course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_deliverable_course" ADD CONSTRAINT "course-video-manager_deliverable_course_deliverable_id_course-video-manager_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."course-video-manager_deliverable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_deliverable_course" ADD CONSTRAINT "course-video-manager_deliverable_course_course_id_course-video-manager_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course-video-manager_course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_deliverable_pitch" ADD CONSTRAINT "course-video-manager_deliverable_pitch_deliverable_id_course-video-manager_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."course-video-manager_deliverable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_deliverable_pitch" ADD CONSTRAINT "course-video-manager_deliverable_pitch_pitch_id_course-video-manager_pitch_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."course-video-manager_pitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_diagram_snapshot" ADD CONSTRAINT "course-video-manager_diagram_snapshot_diagram_id_course-video-manager_diagram_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."course-video-manager_diagram"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_lesson" ADD CONSTRAINT "course-video-manager_lesson_section_id_course-video-manager_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."course-video-manager_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_section" ADD CONSTRAINT "course-video-manager_section_course_version_id_course-video-manager_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course-video-manager_course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_thumbnail" ADD CONSTRAINT "course-video-manager_thumbnail_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_video" ADD CONSTRAINT "course-video-manager_video_lesson_id_course-video-manager_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."course-video-manager_lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_video" ADD CONSTRAINT "course-video-manager_video_pitch_id_course-video-manager_pitch_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."course-video-manager_pitch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_slug_uniq" ON "course-video-manager_course" USING btree ("slug") WHERE NOT "course-video-manager_course"."archived";--> statement-breakpoint
CREATE UNIQUE INDEX "diagram_snapshot_diagram_id_content_hash_idx" ON "course-video-manager_diagram_snapshot" USING btree ("diagram_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_section_order_uniq" ON "course-video-manager_lesson" USING btree ("section_id","order") WHERE NOT "course-video-manager_lesson"."archived";--> statement-breakpoint
CREATE UNIQUE INDEX "section_version_order_uniq" ON "course-video-manager_section" USING btree ("course_version_id","order") WHERE "course-video-manager_section"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "video_lesson_title_uniq" ON "course-video-manager_video" USING btree ("lesson_id","title") WHERE NOT "course-video-manager_video"."archived";