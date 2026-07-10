import { Data, Effect, JSONSchema, Schema } from "effect";
import { computeExportHash, type ExportClip } from "@/services/export-hash";
import { computeEffectiveSections } from "./effective-sections";
import {
  computeLessonWarnings,
  deriveVideoRole,
} from "@/services/lesson-warnings";
import { buildChapters } from "@/services/publish-to-dropbox";

// ── Schema ──────────────────────────────────────────────────────────────

// Descriptions on every field are load-bearing: `buildCourseJsonSchema` turns
// this schema into the `course.schema.json` sidecar via `JSONSchema.make`, which
// reads these annotations verbatim. Keep them in the domain's language (see
// CONTEXT.md) — this is the published contract for a course.json.

const CourseJsonChapter = Schema.Struct({
  title: Schema.String.annotations({
    description: "The chapter name shown to viewers; maps 1:1 to a YouTube chapter.",
  }),
  startTime: Schema.Number.annotations({
    description:
      "Offset in seconds from the start of the video where this chapter begins.",
  }),
}).annotations({
  description:
    "A named marker within a video's timeline that groups related clips.",
});

const CourseJsonVideo = Schema.Struct({
  id: Schema.String.annotations({
    description: "Stable lineage id of the video, carried across course versions.",
  }),
  body: Schema.NullOr(Schema.String).annotations({
    description:
      "Long-form written companion to the video (its article body), or null when none was authored.",
  }),
  description: Schema.NullOr(Schema.String).annotations({
    description: "Short description of the video, or null when none was authored.",
  }),
  hash: Schema.NullOr(Schema.String).annotations({
    description:
      "Export Hash identifying the rendered .mp4 (SHA256 of the video's clip filenames and timestamps in sequence, plus the Export Version Key); null when the video has no exportable clips.",
  }),
  chapters: Schema.Array(CourseJsonChapter).annotations({
    description: "The video's chapters, in timeline order.",
  }),
}).annotations({
  description:
    "A single producible video output — a container of clips and chapters.",
});

const ExplainerLessonSchema = Schema.Struct({
  type: Schema.Literal("explainer").annotations({
    description: "Discriminant marking this lesson as a single-video explainer.",
  }),
  id: Schema.String.annotations({
    description: "Stable lineage id of the lesson, carried across course versions.",
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
    description: "Stable lineage id of the lesson, carried across course versions.",
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

const CourseJsonLessonSchema = Schema.Union(
  ExplainerLessonSchema,
  ProblemLessonSchema
).annotations({
  description: "A single learning unit within a section.",
});

const CourseJsonSectionSchema = Schema.Struct({
  id: Schema.String.annotations({
    description: "Stable lineage id of the section, carried across course versions.",
  }),
  title: Schema.String.annotations({
    description: "The section title shown to learners.",
  }),
  lessons: Schema.Array(CourseJsonLessonSchema).annotations({
    description: "The lessons that ship in this section, in display order.",
  }),
}).annotations({
  description: "A grouping of lessons within the course, in display order.",
});

export const CourseJsonDocumentSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotations({
    description:
      "Relative path to the JSON Schema describing this document (course.schema.json).",
  }),
  schemaVersion: Schema.Literal(2).annotations({
    description: "Version of the course.json manifest format.",
  }),
  courseId: Schema.String.annotations({
    description: "Stable identifier of the course this manifest snapshots.",
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

// ── Error ───────────────────────────────────────────────────────────────

export class InvalidLessonRoleComboError extends Data.TaggedError(
  "InvalidLessonRoleComboError"
)<{
  sectionPath: string;
  lessonPath: string;
  videoTitles: string[];
}> {}

// ── Input types ─────────────────────────────────────────────────────────

type InputClip = {
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
  order: string;
};

type InputChapter = {
  order: string;
  name: string;
};

type InputVideo = {
  lineageId: string;
  title: string;
  body: string | null;
  description: string | null;
  archived: boolean;
  clips: InputClip[];
  chapters: InputChapter[];
};

type InputLesson = {
  lineageId: string;
  path: string;
  title: string;
  description: string;
  authoringStatus: string | null;
  videos: InputVideo[];
};

type InputSection = {
  lineageId: string;
  path: string;
  title: string;
  description: string;
  lessons: InputLesson[];
};

export type BuildCourseJsonInput = {
  courseId: string;
  courseName: string;
  sections: InputSection[];
  // Whether Lessons still marked to-do ship in this manifest. When false, every
  // to-do Lesson is withheld — omitted from course.json entirely, and Sections
  // left with no shippable Lessons disappear.
  includeTodoLessons: boolean;
};

// ── Builder ─────────────────────────────────────────────────────────────

function toVideoEntry(video: InputVideo): typeof CourseJsonVideo.Type {
  const exportClips: ExportClip[] = video.clips.map((c) => ({
    videoFilename: c.videoFilename,
    sourceStartTime: c.sourceStartTime,
    sourceEndTime: c.sourceEndTime,
  }));
  return {
    id: video.lineageId,
    body: video.body,
    description: video.description,
    hash: computeExportHash(exportClips),
    chapters: buildChapters(video.clips, video.chapters) ?? [],
  };
}

export const buildCourseJson = (
  input: BuildCourseJsonInput
): Effect.Effect<CourseJsonDocument, InvalidLessonRoleComboError> =>
  Effect.gen(function* () {
    const sections: Array<typeof CourseJsonSectionSchema.Type> = [];

    // The effective-output filter is the single home of "what this publish
    // ships": it drops to-do Lessons when they are withheld, Lessons with no
    // active Videos, and Sections left with no shippable Lessons. Everything
    // below then models only what actually ships.
    const effectiveSections = computeEffectiveSections(
      input.sections,
      input.includeTodoLessons
    );

    for (const section of effectiveSections) {
      const lessons: Array<typeof CourseJsonLessonSchema.Type> = [];

      for (const lesson of section.lessons) {
        const activeVideos = lesson.videos.filter((v) => !v.archived);
        if (activeVideos.length === 0) continue;

        const warnings = computeLessonWarnings({ videos: activeVideos });
        if (warnings.length > 0) {
          return yield* new InvalidLessonRoleComboError({
            sectionPath: section.path,
            lessonPath: lesson.path,
            videoTitles: activeVideos.map((v) => v.title),
          });
        }

        const roleMap = activeVideos.map((v) => ({
          video: v,
          role: deriveVideoRole(v.title),
        }));

        const problem = roleMap.find((r) => r.role === "problem");
        const solution = roleMap.find((r) => r.role === "solution");
        const explainer = roleMap.find((r) => r.role === "explainer");

        if (problem) {
          if (solution) {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              title: lesson.title,
              problem: toVideoEntry(problem.video),
              solution: toVideoEntry(solution.video),
            });
          } else {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              title: lesson.title,
              problem: toVideoEntry(problem.video),
            });
          }
        } else {
          const video = explainer?.video ?? activeVideos[0]!;
          lessons.push({
            type: "explainer",
            id: lesson.lineageId,
            title: lesson.title,
            explainer: toVideoEntry(video),
          });
        }
      }

      // Emit a Section only when it actually ships Lessons. Sections are
      // decided by their shippable Lessons, not by a derived path — an empty
      // Section (whether it never had Lessons or had them all withheld/archived
      // upstream) produces no course.json entry, never an empty lessons array.
      if (lessons.length === 0) continue;

      sections.push({
        id: section.lineageId,
        title: section.title,
        lessons,
      });
    }

    return {
      $schema: "./course.schema.json",
      schemaVersion: 2 as const,
      courseId: input.courseId,
      courseName: input.courseName,
      sections,
    };
  });
