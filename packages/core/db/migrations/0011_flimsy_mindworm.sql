CREATE TABLE "course-video-manager_diagram_component" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scene_fragment" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
