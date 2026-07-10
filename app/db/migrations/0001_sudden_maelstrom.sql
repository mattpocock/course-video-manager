ALTER TABLE "course-video-manager_diagram_snapshot" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "course-video-manager_diagram_snapshot" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;--> statement-breakpoint
ALTER TABLE "course-video-manager_diagram" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "course-video-manager_diagram" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;--> statement-breakpoint
CREATE INDEX "diagram_snapshot_search_vector_idx" ON "course-video-manager_diagram_snapshot" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "diagram_search_vector_idx" ON "course-video-manager_diagram" USING gin ("search_vector");