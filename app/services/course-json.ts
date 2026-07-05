import { Data, Effect, Schema } from "effect";
import { computeExportHash, type ExportClip } from "./export-hash";
import { computeLessonWarnings, deriveVideoRole } from "./lesson-warnings";
import { buildChapters } from "./publish-to-dropbox";

// ── Schema ──────────────────────────────────────────────────────────────

const CourseJsonChapter = Schema.Struct({
  title: Schema.String,
  startTime: Schema.Number,
});

const CourseJsonVideo = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  body: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  hash: Schema.NullOr(Schema.String),
  chapters: Schema.Array(CourseJsonChapter),
});

const ExplainerLessonSchema = Schema.Struct({
  type: Schema.Literal("explainer"),
  id: Schema.String,
  path: Schema.String,
  title: Schema.String,
  description: Schema.String,
  explainer: CourseJsonVideo,
});

const ProblemLessonSchema = Schema.Struct({
  type: Schema.Literal("problem"),
  id: Schema.String,
  path: Schema.String,
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
  path: Schema.String,
  description: Schema.String,
  lessons: Schema.Array(CourseJsonLessonSchema),
});

export const CourseJsonDocumentSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
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
  videoPaths: string[];
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
  path: string;
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
  fsStatus: string;
  videos: InputVideo[];
};

type InputSection = {
  lineageId: string;
  path: string;
  description: string;
  lessons: InputLesson[];
};

export type BuildCourseJsonInput = {
  courseId: string;
  courseName: string;
  sections: InputSection[];
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
    path: video.path,
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

    for (const section of input.sections) {
      const lessons: Array<typeof CourseJsonLessonSchema.Type> = [];

      for (const lesson of section.lessons) {
        if (lesson.fsStatus === "ghost") continue;

        const activeVideos = lesson.videos.filter((v) => !v.archived);
        if (activeVideos.length === 0) continue;

        const warnings = computeLessonWarnings({ videos: activeVideos });
        if (warnings.length > 0) {
          return yield* new InvalidLessonRoleComboError({
            sectionPath: section.path,
            lessonPath: lesson.path,
            videoPaths: activeVideos.map((v) => v.path),
          });
        }

        const roleMap = activeVideos.map((v) => ({
          video: v,
          role: deriveVideoRole(v.path),
        }));

        const problem = roleMap.find((r) => r.role === "problem");
        const solution = roleMap.find((r) => r.role === "solution");
        const explainer = roleMap.find((r) => r.role === "explainer");

        if (problem) {
          if (solution) {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              path: lesson.path,
              title: lesson.title,
              description: lesson.description,
              problem: toVideoEntry(problem.video),
              solution: toVideoEntry(solution.video),
            });
          } else {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              path: lesson.path,
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
            path: lesson.path,
            title: lesson.title,
            description: lesson.description,
            explainer: toVideoEntry(video),
          });
        }
      }

      sections.push({
        id: section.lineageId,
        path: section.path,
        description: section.description,
        lessons,
      });
    }

    return {
      schemaVersion: 1 as const,
      courseId: input.courseId,
      courseName: input.courseName,
      sections,
    };
  });
