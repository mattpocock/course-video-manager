CREATE TABLE "course-video-manager_beat_learning_goal" (
	"beat_id" varchar(255) NOT NULL,
	"learning_goal_id" varchar(255) NOT NULL,
	CONSTRAINT "course-video-manager_beat_learning_goal_beat_id_learning_goal_id_pk" PRIMARY KEY("beat_id","learning_goal_id")
);
--> statement-breakpoint
ALTER TABLE "course-video-manager_beat_learning_goal" ADD CONSTRAINT "course-video-manager_beat_learning_goal_beat_id_course-video-manager_beat_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."course-video-manager_beat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course-video-manager_beat_learning_goal" ADD CONSTRAINT "course-video-manager_beat_learning_goal_learning_goal_id_course-video-manager_learning_goal_id_fk" FOREIGN KEY ("learning_goal_id") REFERENCES "public"."course-video-manager_learning_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beat_learning_goal_learning_goal_id_idx" ON "course-video-manager_beat_learning_goal" USING btree ("learning_goal_id");