CREATE TABLE "course-video-manager_overlay" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"clip_id" varchar(255) NOT NULL,
	"at" double precision NOT NULL,
	"duration_in_seconds" double precision NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_overlay" ADD CONSTRAINT "course-video-manager_overlay_clip_id_course-video-manager_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."course-video-manager_clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "overlay_clip_id_idx" ON "course-video-manager_overlay" USING btree ("clip_id");