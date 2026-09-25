// THE PUBLISHED CONTRACT for a course.json — the schema, and nothing else.
//
// Split out of `build-course-json.ts` so the contract can be read on its own:
// this file says what a manifest IS, that file says how one is produced.
//
// Descriptions on every field are load-bearing: `buildCourseJsonSchema` turns
// this schema into the `course.schema.json` sidecar via `JSONSchema.make`, which
// reads these annotations verbatim. Keep them in the domain's language (see
// CONTEXT.md).

import { JSONSchema, Schema } from "effect";

const CourseJsonChapter = Schema.Struct({
  title: Schema.String.annotations({
    description:
      "The chapter name shown to viewers; maps 1:1 to a YouTube chapter.",
  }),
  startTime: Schema.Number.annotations({
    description:
      "Offset in seconds from the start of the video where this chapter begins.",
  }),
}).annotations({
  description:
    "A named marker within a video's timeline that groups related clips.",
});

export const CourseJsonVideo = Schema.Struct({
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the video, carried across course versions.",
  }),
  relativePath: Schema.String.annotations({
    description:
      "Path to the exported .mp4 relative to this course.json (section-dir/lesson-dir/VideoTitle.mp4).",
  }),
  body: Schema.String.annotations({
    description: "Long-form written companion to the video (its article body).",
  }),
  description: Schema.String.annotations({
    description: "Short description of the video.",
  }),
  hash: Schema.String.annotations({
    description:
      "Export Hash identifying the exported .mp4 inputs (SHA256 of the video's clip filenames and timestamps in sequence, plus the Export Version Key).",
  }),
  sha256: Schema.String.pipe(
    Schema.pattern(/^[a-f0-9]{64}$/),
    Schema.annotations({
      description:
        "Full lowercase hexadecimal SHA256 of the exported .mp4 bytes.",
    })
  ),
  bytes: Schema.Number.pipe(
    Schema.int(),
    Schema.nonNegative(),
    Schema.annotations({
      description: "Non-negative integer size of the exported .mp4 in bytes.",
    })
  ),
  chapters: Schema.Array(CourseJsonChapter).annotations({
    description: "The video's chapters, in timeline order.",
  }),
}).annotations({
  description:
    "A single producible video output — a container of clips and chapters.",
});

const ExplainerLessonSchema = Schema.Struct({
  type: Schema.Literal("explainer").annotations({
    description:
      "Discriminant marking this lesson as a single-video explainer.",
  }),
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the lesson, carried across course versions.",
  }),
  title: Schema.String.annotations({
    description: "The lesson title shown to learners.",
  }),
  explainer: CourseJsonVideo.annotations({
    description: "The explainer video that delivers this lesson.",
  }),
}).annotations({
  description:
    "A lesson delivered as a single explainer video (no problem/solution split).",
});

const ProblemLessonSchema = Schema.Struct({
  type: Schema.Literal("problem").annotations({
    description: "Discriminant marking this lesson as a problem/solution pair.",
  }),
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the lesson, carried across course versions.",
  }),
  title: Schema.String.annotations({
    description: "The lesson title shown to learners.",
  }),
  problem: CourseJsonVideo.annotations({
    description: "The problem video the learner attempts.",
  }),
  solution: Schema.optional(
    CourseJsonVideo.annotations({
      description:
        "The worked-solution video; present only when the lesson ships a solution.",
    })
  ),
}).annotations({
  description:
    "A lesson delivered as a problem video with an optional worked-solution video.",
});

const PlaceholderLessonSchema = Schema.Struct({
  type: Schema.Literal("placeholder").annotations({
    description:
      "Discriminant marking this lesson as a Placeholder Lesson — announced by title alone, with no video yet.",
  }),
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the lesson, carried across course versions. The same id the lesson carries when it later ships in full, so the consumer updates one resource rather than creating a second.",
  }),
  title: Schema.String.annotations({
    description: "The lesson title shown to learners.",
  }),
}).annotations({
  description:
    "A Placeholder Lesson: a lesson announced by title alone. It carries no video, no body and no description, because nobody has filmed it yet. Exactly these three keys, never a fourth.",
});

export const CourseJsonLessonSchema = Schema.Union(
  ExplainerLessonSchema,
  ProblemLessonSchema,
  PlaceholderLessonSchema
).annotations({
  description: "A single learning unit within a section.",
});

export const CourseJsonSectionSchema = Schema.Struct({
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the section, carried across course versions.",
  }),
  title: Schema.String.annotations({
    description: "The section title shown to learners.",
  }),
  lessons: Schema.Array(CourseJsonLessonSchema).annotations({
    description:
      "The lessons this release carries in this section, in display order — the ones that ship in full and the ones announced as Placeholder Lessons.",
  }),
}).annotations({
  description: "A grouping of lessons within the course, in display order.",
});

export const CourseJsonDocumentSchema = Schema.Struct({
  $schema: Schema.String.annotations({
    description:
      "Relative path to the JSON Schema describing this document (course.schema.json).",
  }),
  schemaVersion: Schema.Literal(4).annotations({
    description: "Version of the course.json manifest format.",
  }),
  courseId: Schema.String.annotations({
    description: "Stable identifier of the course this manifest snapshots.",
  }),
  courseVersionId: Schema.String.annotations({
    description:
      "Immutable Course Version identifier whose structure this manifest snapshots.",
  }),
  archiveTTL: Schema.Literal("90d").annotations({
    description:
      "Retention window for this immutable Course Version bundle, starting when the manifest is written to Dropbox. After this duration Course Builder may remove the bundle.",
  }),
  courseName: Schema.String.annotations({
    description: "Human-readable name of the course.",
  }),
  sections: Schema.Array(CourseJsonSectionSchema).annotations({
    description: "The sections that ship in this course, in display order.",
  }),
}).annotations({
  title: "Course Manifest",
  description:
    "The published manifest of a course — an immutable snapshot of its sections, lessons, and videos, emitted alongside the exported .mp4 files at publish time.",
});

export type CourseJsonDocument = typeof CourseJsonDocumentSchema.Type;

// The JSON Schema sidecar (`course.schema.json`) generated from
// `CourseJsonDocumentSchema`. A pure function of the schema — invariant across
// courses and publishes — so callers can write it verbatim next to course.json.
export const buildCourseJsonSchema = (): JSONSchema.JsonSchema7Root =>
  JSONSchema.make(CourseJsonDocumentSchema);
