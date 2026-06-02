/**
 * Schema definitions for CourseEditorService RPC events.
 * Used by the route handler to validate incoming requests.
 */

import { Schema } from "effect";

const nonEmptyString = Schema.String.pipe(Schema.minLength(1));

export const CourseEditorEventSchema = Schema.Union(
  // --- Section events ---
  Schema.Struct({
    type: Schema.Literal("create-section"),
    repoVersionId: nonEmptyString,
    title: nonEmptyString,
    maxOrder: Schema.Number,
    adjacentSectionId: Schema.optional(nonEmptyString),
    position: Schema.optional(Schema.Literal("before", "after")),
  }),
  Schema.Struct({
    type: Schema.Literal("update-section-name"),
    sectionId: nonEmptyString,
    title: nonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("update-section-description"),
    sectionId: nonEmptyString,
    description: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("archive-section"),
    sectionId: nonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("reorder-sections"),
    sectionIds: Schema.Array(nonEmptyString),
  }),
  // --- Lesson events ---
  Schema.Struct({
    type: Schema.Literal("add-ghost-lesson"),
    sectionId: nonEmptyString,
    title: nonEmptyString,
    adjacentLessonId: Schema.optional(nonEmptyString),
    position: Schema.optional(Schema.Literal("before", "after")),
  }),
  Schema.Struct({
    type: Schema.Literal("create-real-lesson"),
    sectionId: nonEmptyString,
    title: nonEmptyString,
    adjacentLessonId: Schema.optional(nonEmptyString),
    position: Schema.optional(Schema.Literal("before", "after")),
  }),
  Schema.Struct({
    type: Schema.Literal("update-lesson-name"),
    lessonId: nonEmptyString,
    newSlug: nonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("update-lesson-title"),
    lessonId: nonEmptyString,
    title: nonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("update-lesson-description"),
    lessonId: nonEmptyString,
    description: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("update-lesson-icon"),
    lessonId: nonEmptyString,
    icon: Schema.Literal("watch", "code", "discussion"),
  }),
  Schema.Struct({
    type: Schema.Literal("update-lesson-priority"),
    lessonId: nonEmptyString,
    priority: Schema.Literal(1, 2, 3),
  }),
  Schema.Struct({
    type: Schema.Literal("update-lesson-dependencies"),
    lessonId: nonEmptyString,
    dependencies: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("delete-lesson"),
    lessonId: nonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("reorder-lessons"),
    sectionId: nonEmptyString,
    lessonIds: Schema.Array(nonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("move-lesson-to-section"),
    lessonId: nonEmptyString,
    targetSectionId: nonEmptyString,
    beforeLessonId: Schema.optional(Schema.NullOr(nonEmptyString)),
  }),
  Schema.Struct({
    type: Schema.Literal("convert-to-ghost"),
    lessonId: nonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("create-on-disk"),
    lessonId: nonEmptyString,
    repoPath: Schema.optional(nonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("set-lesson-authoring-status"),
    lessonId: nonEmptyString,
    status: Schema.Literal("todo", "done"),
  })
);
