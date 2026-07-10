import { Data, Effect, Schema } from "effect";
import { computeExportHash, type ExportClip } from "@/services/export-hash";
import { computeEffectiveSections } from "./effective-sections";
import {
  computeLessonWarnings,
  deriveVideoRole,
} from "@/services/lesson-warnings";
import { buildChapters } from "@/services/publish-to-dropbox";

// ── Schema ──────────────────────────────────────────────────────────────

const CourseJsonChapter = Schema.Struct({
  title: Schema.String,
  startTime: Schema.Number,
});

const CourseJsonVideo = Schema.Struct({
  id: Schema.String,
  body: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  hash: Schema.NullOr(Schema.String),
  chapters: Schema.Array(CourseJsonChapter),
});

const ExplainerLessonSchema = Schema.Struct({
  type: Schema.Literal("explainer"),
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  explainer: CourseJsonVideo,
});

const ProblemLessonSchema = Schema.Struct({
  type: Schema.Literal("problem"),
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  problem: CourseJsonVideo,
  solution: Schema.optional(CourseJsonVideo),
});

const CourseJsonLessonSchema = Schema.Union(
  ExplainerLessonSchema,
  ProblemLessonSchema
);

const CourseJsonSectionSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  lessons: Schema.Array(CourseJsonLessonSchema),
});

export const CourseJsonDocumentSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  courseId: Schema.String,
  courseName: Schema.String,
  sections: Schema.Array(CourseJsonSectionSchema),
});

export type CourseJsonDocument = typeof CourseJsonDocumentSchema.Type;

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
    order: c.order,
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
              description: lesson.description,
              problem: toVideoEntry(problem.video),
              solution: toVideoEntry(solution.video),
            });
          } else {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              title: lesson.title,
              description: lesson.description,
              problem: toVideoEntry(problem.video),
            });
          }
        } else {
          const video = explainer?.video ?? activeVideos[0]!;
          lessons.push({
            type: "explainer",
            id: lesson.lineageId,
            title: lesson.title,
            description: lesson.description,
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
        description: section.description,
        lessons,
      });
    }

    return {
      schemaVersion: 2 as const,
      courseId: input.courseId,
      courseName: input.courseName,
      sections,
    };
  });
