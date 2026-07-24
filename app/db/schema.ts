import type { DatabaseId } from "@/features/video-editor/clip-state-reducer";
import { relations, sql, type InferSelectModel } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createTable } from "./table-creator";
export { createTable } from "./table-creator";

const varcharCollateC = customType<{
  data: string;
  notNull: boolean;
  default: boolean;
}>({
  dataType() {
    return 'varchar(255) COLLATE "C"';
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const courses = createTable(
  "course",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    slug: text("slug"),
    archived: boolean("archived").notNull().default(false),
    memory: text("memory").notNull().default(""),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("course_slug_uniq")
      .on(table.slug)
      .where(sql`NOT ${table.archived}`),
  ]
);

/**
 * The CourseVersion lifecycle: Draft → Pending → Published.
 * - `draft`: the single mutable CourseVersion per course — the only state
 *   that accepts section/lesson/video/clip writes.
 * - `pending`: Submitted for publish — name/description stamped, a fresh
 *   Draft cloned. At most one Pending per course. A Pending is either
 *   Promoted (its Dropbox `course.json` rename committed) or Discarded.
 * - `published`: immutable, never deleted.
 * The database is authoritative for this state; no positional/name-based
 * inference (see issue #1348).
 */
export type CourseVersionCommitState = "draft" | "pending" | "published";

export const courseVersions = createTable(
  "course_version",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repoId: varchar("course_id", { length: 255 })
      .references(() => courses.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    commitState: text("commit_state")
      .$type<CourseVersionCommitState>()
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // At most one Pending Version per course (issue #1348) — Submit checks
    // this in-transaction; the partial index makes the DB authoritative.
    uniqueIndex("course_version_one_pending_uniq")
      .on(table.repoId)
      .where(sql`${table.commitState} = 'pending'`),
  ]
);

export const sections = createTable(
  "section",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repoVersionId: varchar("course_version_id", { length: 255 })
      .references(() => courseVersions.id, { onDelete: "cascade" })
      .notNull(),
    previousVersionSectionId: varchar("previous_version_section_id", {
      length: 255,
    }),
    lineageId: varchar("lineage_id", { length: 255 })
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    order: doublePrecision("order").notNull(),
  },
  (table) => [
    uniqueIndex("section_version_order_uniq")
      .on(table.repoVersionId, table.order)
      .where(sql`${table.archivedAt} IS NULL`),
  ]
);

export const lessons = createTable(
  "lesson",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sectionId: varchar("section_id", { length: 255 })
      .references(() => sections.id, { onDelete: "cascade" })
      .notNull(),
    previousVersionLessonId: varchar("previous_version_lesson_id", {
      length: 255,
    }),
    lineageId: varchar("lineage_id", { length: 255 })
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    icon: varchar("icon", { length: 255 }),
    priority: integer("priority").notNull().default(2),
    dependencies: text("dependencies").array(),
    authoringStatus: text("authoring_status"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    order: doublePrecision("order").notNull(),
    archived: boolean("archived").notNull().default(false),
  },
  (table) => [
    uniqueIndex("lesson_section_order_uniq")
      .on(table.sectionId, table.order)
      .where(sql`NOT ${table.archived}`),
  ]
);

export const pitches = createTable("pitch", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  contentPlan: text("content_plan").notNull().default(""),
  youtubeTitle: text("youtube_title").notNull().default(""),
  youtubeThumbnailDescription: text("youtube_thumbnail_description")
    .notNull()
    .default(""),
  newsletterTitle: text("newsletter_title").notNull().default(""),
  tweet: text("tweet").notNull().default(""),
  priority: integer("priority").notNull().default(2),
  effort: integer("effort").notNull().default(2),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const videos = createTable(
  "video",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    lessonId: varchar("lesson_id", { length: 255 }).references(
      () => lessons.id,
      {
        onDelete: "cascade",
      }
    ),
    pitchId: varchar("pitch_id", { length: 255 }).references(() => pitches.id, {
      onDelete: "set null",
    }),
    lineageId: varchar("lineage_id", { length: 255 })
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    originalFootagePath: text("original_footage_path").notNull(),
    body: text("body"),
    description: text("video_description"),
    // The high-fidelity, screenplay-style plan read off the teleprompter while
    // filming. Internal like beats: copied into version snapshots but never
    // emitted into the shipped course.json.
    script: text("script"),
    archived: boolean("archived").notNull().default(false),
    format: text("format").notNull().default("landscape"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("video_lesson_title_uniq")
      .on(table.lessonId, table.title)
      .where(sql`NOT ${table.archived}`),
  ]
);

export const clips = createTable("clip", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  videoFilename: text("video_filename").notNull(),
  sourceStartTime: doublePrecision("source_start_time").notNull(),
  sourceEndTime: doublePrecision("source_end_time").notNull(),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  order: varcharCollateC("order").notNull(),
  archived: boolean("archived").notNull().default(false),
  text: text("text").notNull(),
  transcribedAt: timestamp("transcribed_at", {
    mode: "date",
    withTimezone: true,
  }),
  scene: varchar("scene", { length: 255 }),
  profile: varchar("profile", { length: 255 }),
  pauseType: varchar("pause_type", { length: 255 }).notNull().default("none"),
  diagramSnapshotId: varchar("diagram_snapshot_id", { length: 255 }).references(
    () => diagramSnapshots.id,
    { onDelete: "set null" }
  ),
});

/**
 * Web pages that were on screen (in a focused Chrome window) while a clip was
 * being recorded. Captured live during the optimistic-clip lifecycle from the
 * browser link-capture extension, one row per distinct URL shown during the
 * clip. See docs/adr/0020-clip-web-links-over-websocket.md and the
 * `chrome-extension/` directory.
 */
export const clipWebLinks = createTable("clip_web_link", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  clipId: varchar("clip_id", { length: 255 })
    .references(() => clips.id, { onDelete: "cascade" })
    .notNull(),
  url: text("url").notNull(),
  title: text("title"),
  // Wall-clock time the URL was first shown during the clip. Used to order the
  // links within a clip chronologically.
  capturedAt: timestamp("captured_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const videoPosts = createTable("video_post", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  platform: text("platform").notNull(),
  remoteId: text("remote_id"),
  remoteUrl: text("remote_url"),
  postedAt: timestamp("posted_at", {
    mode: "date",
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const chapters = createTable("chapter", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  order: varcharCollateC("order").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const beats = createTable("beat", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Mutable on purpose: dragging a Beat into another Video reassigns this FK.
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  kind: text("kind").notNull().default("definition"),
  title: text("title").notNull().default(""),
  // In-app planning note ("what am I going to do/say here"). Never published —
  // publish skips it exactly as it skips the Beat plan itself.
  description: text("description").notNull().default(""),
  order: varcharCollateC("order").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export namespace DB {
  export interface Clip extends Omit<InferSelectModel<typeof clips>, "id"> {
    id: DatabaseId;
  }

  export interface Chapter extends Omit<
    InferSelectModel<typeof chapters>,
    "id"
  > {
    id: DatabaseId;
  }

  export interface ClipWebLink extends Omit<
    InferSelectModel<typeof clipWebLinks>,
    "id" | "clipId"
  > {
    id: DatabaseId;
    clipId: DatabaseId;
  }
}

export const clipsRelations = relations(clips, ({ one, many }) => ({
  video: one(videos, { fields: [clips.videoId], references: [videos.id] }),
  diagramSnapshot: one(diagramSnapshots, {
    fields: [clips.diagramSnapshotId],
    references: [diagramSnapshots.id],
  }),
  webLinks: many(clipWebLinks),
}));

export const clipWebLinksRelations = relations(clipWebLinks, ({ one }) => ({
  clip: one(clips, {
    fields: [clipWebLinks.clipId],
    references: [clips.id],
  }),
}));

export const videoPostsRelations = relations(videoPosts, ({ one }) => ({
  video: one(videos, {
    fields: [videoPosts.videoId],
    references: [videos.id],
  }),
}));

export const chaptersRelations = relations(chapters, ({ one }) => ({
  video: one(videos, {
    fields: [chapters.videoId],
    references: [videos.id],
  }),
}));

export const pitchesRelations = relations(pitches, ({ many }) => ({
  videos: many(videos),
  deliverablesPitches: many(deliverablesPitches),
}));

export const beatsRelations = relations(beats, ({ one }) => ({
  video: one(videos, {
    fields: [beats.videoId],
    references: [videos.id],
  }),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  lesson: one(lessons, { fields: [videos.lessonId], references: [lessons.id] }),
  pitch: one(pitches, { fields: [videos.pitchId], references: [pitches.id] }),
  clips: many(clips),
  chapters: many(chapters),
  thumbnails: many(thumbnails),
  beats: many(beats),
  videoPosts: many(videoPosts),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  section: one(sections, {
    fields: [lessons.sectionId],
    references: [sections.id],
  }),
  videos: many(videos),
}));

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  repoVersion: one(courseVersions, {
    fields: [sections.repoVersionId],
    references: [courseVersions.id],
  }),
  lessons: many(lessons),
}));

export const courseVersionsRelations = relations(
  courseVersions,
  ({ one, many }) => ({
    repo: one(courses, {
      fields: [courseVersions.repoId],
      references: [courses.id],
    }),
    sections: many(sections),
  })
);

export const coursesRelations = relations(courses, ({ many }) => ({
  versions: many(courseVersions),
  deliverablesCourses: many(deliverablesCourses),
}));

export { youtubeAuth, aiHeroAuth, dropboxAuth } from "./schema-auth";

// Global links table for article writing
export const links = createTable("link", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const diagrams = createTable(
  "diagram",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull().default("Untitled 1"),
    headScene: jsonb("head_scene"),
    archived: boolean("archived").notNull().default(false),
    searchText: text("search_text"),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(search_text, ''))`
    ),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("diagram_search_vector_idx").using("gin", table.searchVector),
  ]
);

export const diagramSnapshots = createTable(
  "diagram_snapshot",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    diagramId: varchar("diagram_id", { length: 255 })
      .notNull()
      .references(() => diagrams.id, { onDelete: "cascade" }),
    scene: jsonb("scene").notNull(),
    contentHash: varchar("content_hash", { length: 255 }).notNull(),
    preserved: boolean("preserved").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    searchText: text("search_text"),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(search_text, ''))`
    ),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("diagram_snapshot_diagram_id_content_hash_idx").on(
      table.diagramId,
      table.contentHash
    ),
    index("diagram_snapshot_search_vector_idx").using(
      "gin",
      table.searchVector
    ),
  ]
);

export const diagramSnapshotsRelations = relations(
  diagramSnapshots,
  ({ one, many }) => ({
    diagram: one(diagrams, {
      fields: [diagramSnapshots.diagramId],
      references: [diagrams.id],
    }),
    clips: many(clips),
  })
);

// Thumbnails table for layered thumbnail compositing
export const thumbnails = createTable("thumbnail", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  videoId: varchar("video_id", { length: 255 })
    .references(() => videos.id, { onDelete: "cascade" })
    .notNull(),
  layers: jsonb("layers").notNull(),
  filePath: text("file_path"),
  selectedForUpload: boolean("selected_for_upload").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const thumbnailsRelations = relations(thumbnails, ({ one }) => ({
  video: one(videos, {
    fields: [thumbnails.videoId],
    references: [videos.id],
  }),
}));

export const deliverables = createTable("deliverable", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  notes: text("notes"),
  date: date("date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("planned"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const deliverablesCourses = createTable(
  "deliverable_course",
  {
    deliverableId: varchar("deliverable_id", { length: 255 })
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    courseId: varchar("course_id", { length: 255 })
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.deliverableId, table.courseId] })]
);

export const deliverablesPitches = createTable(
  "deliverable_pitch",
  {
    deliverableId: varchar("deliverable_id", { length: 255 })
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    pitchId: varchar("pitch_id", { length: 255 })
      .notNull()
      .references(() => pitches.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.deliverableId, table.pitchId] })]
);

export const deliverablesRelations = relations(deliverables, ({ many }) => ({
  deliverablesCourses: many(deliverablesCourses),
  deliverablesPitches: many(deliverablesPitches),
}));

export const deliverablesCoursesRelations = relations(
  deliverablesCourses,
  ({ one }) => ({
    deliverable: one(deliverables, {
      fields: [deliverablesCourses.deliverableId],
      references: [deliverables.id],
    }),
    course: one(courses, {
      fields: [deliverablesCourses.courseId],
      references: [courses.id],
    }),
  })
);

export const deliverablesPitchesRelations = relations(
  deliverablesPitches,
  ({ one }) => ({
    deliverable: one(deliverables, {
      fields: [deliverablesPitches.deliverableId],
      references: [deliverables.id],
    }),
    pitch: one(pitches, {
      fields: [deliverablesPitches.pitchId],
      references: [pitches.id],
    }),
  })
);
