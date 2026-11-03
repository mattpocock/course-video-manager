CREATE TABLE "course-video-manager_posting_queue_entry" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"queued_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"order" varchar(255) COLLATE "C" NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"claimed_slot" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"youtube_failures" integer DEFAULT 0 NOT NULL,
	"tiktok_failures" integer DEFAULT 0 NOT NULL,
	"last_failure_reason" text,
	"ended_at" timestamp with time zone,
	CONSTRAINT "posting_queue_entry_state_valid" CHECK ("course-video-manager_posting_queue_entry"."state" IN ('queued', 'posting', 'posted', 'held', 'failed', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_posting_queue_entry" ADD CONSTRAINT "course-video-manager_posting_queue_entry_video_id_course-video-manager_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course-video-manager_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "posting_queue_entry_one_live_per_video_uniq" ON "course-video-manager_posting_queue_entry" USING btree ("video_id") WHERE "course-video-manager_posting_queue_entry"."state" IN ('queued', 'posting', 'held');--> statement-breakpoint
CREATE UNIQUE INDEX "posting_queue_entry_claimed_slot_uniq" ON "course-video-manager_posting_queue_entry" USING btree ("claimed_slot");--> statement-breakpoint
CREATE INDEX "posting_queue_entry_ended_at_idx" ON "course-video-manager_posting_queue_entry" USING btree ("ended_at");