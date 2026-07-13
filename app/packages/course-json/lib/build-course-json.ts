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

const CourseJsonVideo = Schema.Struct({
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
      "Export Hash identifying the rendered .mp4 (SHA256 of the video's clip filenames and timestamps in sequence, plus the Export Version Key).",
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

const CourseJsonLessonSchema = Schema.Union(
  ExplainerLessonSchema,
  ProblemLessonSchema
).annotations({
  description: "A single learning unit within a section.",
});

const CourseJsonSectionSchema = Schema.Struct({
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the section, carried across course versions.",
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
  $schema: Schema.String.annotations({
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

// ── Publish blockers ──────────────────────────────────────────────────────

// A Lesson whose active Videos don't form a valid role combo (a lone solution,
// an explainer beside a problem, duplicate roles, 3+ videos, …). We can't tell
// which Video is the problem vs solution, so the whole Lesson is flagged.
export type InvalidLessonCombo = {
  sectionPath: string;
  lessonPath: string;
  videoTitles: string[];
};

// What a shipping Video is missing to be publishable. A Video that reaches
// course.json must carry exportable clips (so it produces an .mp4 and an Export
// Hash) and both a body and a description — each is required, never nullable.
// Any absence is a gap on our side, not real optionality.
export type IncompleteVideo = {
  sectionPath: string;
  lessonPath: string;
  videoTitle: string;
  missing: Array<"clips" | "body" | "description">;
};

// Everything that would make a Publish fail, enumerated in full. The pre-publish
// page reads this to warn (and block) before a doomed publish is ever started;
// `buildCourseJson` reads the same result as its backstop — so the thing that
// warns you is literally the thing that would fail.
export type PublishBlockers = {
  invalidLessonCombos: InvalidLessonCombo[];
  incompleteVideos: IncompleteVideo[];
};

// ── Errors ──────────────────────────────────────────────────────────────

export class InvalidLessonRoleComboError extends Data.TaggedError(
  "InvalidLessonRoleComboError"
)<InvalidLessonCombo> {}

// Raised when one or more shipping Videos are incomplete. Publish scans the
// whole course and collects every gap, then fails with the full list — so the
// author fixes all of them in one pass rather than re-running publish per gap,
// and course.json never ships a null for these fields.
export class IncompleteVideosError extends Data.TaggedError(
  "IncompleteVideosError"
)<{
  videos: IncompleteVideo[];
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

// ── Publish-blocker detection ─────────────────────────────────────────────

// The gaps that make a Video unshippable — no exportable clips, no body, or no
// description. An empty result means the Video is complete and may be emitted.
// This is the single gate that lets `toVideoEntry` treat every field as present.
function videoGaps(video: InputVideo): IncompleteVideo["missing"] {
  const missing: IncompleteVideo["missing"] = [];
  if (video.clips.length === 0) missing.push("clips");
  if (video.body === null) missing.push("body");
  if (video.description === null) missing.push("description");
  return missing;
}

// Which Video plays which role in a Lesson. Assumes the active Videos already
// form a valid combo (i.e. `computeLessonWarnings` returned nothing) — the same
// selection the builder and the blocker collector both rely on, so they agree.
type SelectedLessonVideos =
  | { type: "explainer"; video: InputVideo }
  | { type: "problem"; problem: InputVideo; solution?: InputVideo };

function selectLessonVideos(
  activeVideos: readonly InputVideo[]
): SelectedLessonVideos {
  const roleMap = activeVideos.map((v) => ({
    video: v,
    role: deriveVideoRole(v.title),
  }));
  const problem = roleMap.find((r) => r.role === "problem");
  const solution = roleMap.find((r) => r.role === "solution");
  const explainer = roleMap.find((r) => r.role === "explainer");

  if (problem) {
    return {
      type: "problem",
      problem: problem.video,
      solution: solution?.video,
    };
  }
  return { type: "explainer", video: explainer?.video ?? activeVideos[0]! };
}

// The Videos a Lesson actually ships, in course.json order.
function shippingVideos(selected: SelectedLessonVideos): InputVideo[] {
  return selected.type === "problem"
    ? [selected.problem, ...(selected.solution ? [selected.solution] : [])]
    : [selected.video];
}

// The single source of truth for "why can't this publish?". Walks the effective
// output — the exact Lessons and Videos this publish would ship — and returns
// every blocker: Lessons with an invalid role combo, and shipping Videos missing
// a required field. `buildCourseJson` fails on a non-empty result; the publish
// page shows it as pre-publish warnings and blocks the button. One walk, so the
// warning and the failure can never disagree.
export const collectPublishBlockers = (
  sections: readonly InputSection[],
  includeTodoLessons: boolean
): PublishBlockers => {
  const invalidLessonCombos: InvalidLessonCombo[] = [];
  const incompleteVideos: IncompleteVideo[] = [];

  const effectiveSections = computeEffectiveSections(
    sections,
    includeTodoLessons
  );

  for (const section of effectiveSections) {
    for (const lesson of section.lessons) {
      const activeVideos = lesson.videos.filter((v) => !v.archived);
      if (activeVideos.length === 0) continue;

      // An invalid combo makes roles ambiguous, so we can't meaningfully gap-check
      // the individual Videos — flag the Lesson and move on.
      if (computeLessonWarnings({ videos: activeVideos }).length > 0) {
        invalidLessonCombos.push({
          sectionPath: section.path,
          lessonPath: lesson.path,
          videoTitles: activeVideos.map((v) => v.title),
        });
        continue;
      }

      for (const video of shippingVideos(selectLessonVideos(activeVideos))) {
        const missing = videoGaps(video);
        if (missing.length > 0) {
          incompleteVideos.push({
            sectionPath: section.path,
            lessonPath: lesson.path,
            videoTitle: video.title,
            missing,
          });
        }
      }
    }
  }

  return { invalidLessonCombos, incompleteVideos };
};

// ── Builder ─────────────────────────────────────────────────────────────

// The published .mp4 lands beside course.json under section-dir/lesson-dir at
// the video's title (see syncToDropbox's copyFileToDropbox). Only complete
// Videos reach here — `videoGaps` has already been checked and found empty — so
// the clips (hence hash), body, and description are all guaranteed present, and
// every emitted field is non-null.
function toVideoEntry(
  video: InputVideo,
  sectionPath: string,
  lessonPath: string
): typeof CourseJsonVideo.Type {
  const exportClips: ExportClip[] = video.clips.map((c) => ({
    videoFilename: c.videoFilename,
    sourceStartTime: c.sourceStartTime,
    sourceEndTime: c.sourceEndTime,
  }));
  return {
    id: video.lineageId,
    relativePath: `${sectionPath}/${lessonPath}/${video.title}.mp4`,
    body: video.body!,
    description: video.description!,
    hash: computeExportHash(exportClips)!,
    chapters: buildChapters(video.clips, video.chapters) ?? [],
  };
}

export const buildCourseJson = (
  input: BuildCourseJsonInput
): Effect.Effect<
  CourseJsonDocument,
  InvalidLessonRoleComboError | IncompleteVideosError
> =>
  Effect.gen(function* () {
    // The pre-publish gate and this backstop read the exact same blockers, so a
    // manifest can never ship with a hole in it. Invalid role combos come first
    // (they make roles ambiguous); we fail on the first, matching the page, which
    // blocks publish until it's fixed. Incomplete Videos are reported all at once
    // so the author fixes every gap in a single pass.
    const blockers = collectPublishBlockers(
      input.sections,
      input.includeTodoLessons
    );
    if (blockers.invalidLessonCombos.length > 0) {
      return yield* new InvalidLessonRoleComboError(
        blockers.invalidLessonCombos[0]!
      );
    }
    if (blockers.incompleteVideos.length > 0) {
      return yield* new IncompleteVideosError({
        videos: blockers.incompleteVideos,
      });
    }

    const sections: Array<typeof CourseJsonSectionSchema.Type> = [];

    // The effective-output filter is the single home of "what this publish
    // ships": it drops to-do Lessons when they are withheld, Lessons with no
    // active Videos, and Sections left with no shippable Lessons. Everything
    // below then models only what actually ships. Every Lesson here is now a
    // valid combo and every shipping Video complete (checked above).
    const effectiveSections = computeEffectiveSections(
      input.sections,
      input.includeTodoLessons
    );

    for (const section of effectiveSections) {
      const lessons: Array<typeof CourseJsonLessonSchema.Type> = [];

      for (const lesson of section.lessons) {
        const activeVideos = lesson.videos.filter((v) => !v.archived);
        if (activeVideos.length === 0) continue;

        const selected = selectLessonVideos(activeVideos);
        if (selected.type === "problem") {
          if (selected.solution) {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              title: lesson.title,
              problem: toVideoEntry(
                selected.problem,
                section.path,
                lesson.path
              ),
              solution: toVideoEntry(
                selected.solution,
                section.path,
                lesson.path
              ),
            });
          } else {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              title: lesson.title,
              problem: toVideoEntry(
                selected.problem,
                section.path,
                lesson.path
              ),
            });
          }
        } else {
          lessons.push({
            type: "explainer",
            id: lesson.lineageId,
            title: lesson.title,
            explainer: toVideoEntry(selected.video, section.path, lesson.path),
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
