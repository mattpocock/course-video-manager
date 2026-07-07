import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import nodeFs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { FileSystem } from "@effect/platform";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { loadVideoPostingContext } from "@/services/video-posting-context.server";

let testDb: TestDb;
type TestServices =
  | ClipOperationsService
  | VideoOperationsService
  | CourseOperationsService
  | VersionOperationsService
  | LessonSectionOperationsService
  | LinkAuthOperationsService
  | DrizzleService
  | FileSystem.FileSystem;

let testLayer: Layer.Layer<TestServices>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = Layer.mergeAll(
    ClipOperationsService.Default,
    VideoOperationsService.Default,
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    LinkAuthOperationsService.Default,
    drizzleLayer,
    NodeContext.layer
  ).pipe(Layer.provide(drizzleLayer));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const createStandaloneVideoWithClips = (
  name: string,
  clipTexts: string[],
  chapterSpecs?: Array<{ name: string; afterClipIndex: number }>
) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const clipOps = yield* ClipOperationsService;
    const video = yield* videoOps.createStandaloneVideo({ path: name });

    const createdClips = yield* clipOps.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      clips: clipTexts.map((_, i) => ({
        inputVideo: `footage-${i}.mp4`,
        startTime: i * 10,
        endTime: (i + 1) * 10,
      })),
    });

    for (let i = 0; i < clipTexts.length; i++) {
      if (clipTexts[i]) {
        yield* clipOps.updateClip(createdClips[i]!.id, {
          text: clipTexts[i],
        });
      }
    }

    if (chapterSpecs) {
      for (const spec of chapterSpecs) {
        const afterClip = createdClips[spec.afterClipIndex]!;
        yield* clipOps.createChapterAtInsertionPoint(video.id, spec.name, {
          type: "after-clip",
          databaseClipId: afterClip.id,
        });
      }
    }

    return video;
  });

const createLessonVideo = (setupFiles?: (lessonDir: string) => void) =>
  Effect.gen(function* () {
    const tempDir = nodeFs.mkdtempSync(
      path.join(tmpdir(), "posting-ctx-test-")
    );
    const sectionPath = "01-intro";
    const lessonPath = "01.01-getting-started";
    const lessonDir = path.join(tempDir, sectionPath, lessonPath);
    nodeFs.mkdirSync(lessonDir, { recursive: true });
    nodeFs.writeFileSync(path.join(lessonDir, ".gitkeep"), "");

    if (setupFiles) {
      setupFiles(lessonDir);
    }

    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;
    const lsOps = yield* LessonSectionOperationsService;
    const videoOps = yield* VideoOperationsService;

    const course = yield* courseOps.createCourse({
      filePath: tempDir,
      name: "test-course",
    });
    const version = yield* versionOps.createCourseVersion({
      repoId: course.id,
      name: "v1",
    });
    const [section] = yield* lsOps.createSections({
      repoVersionId: version.id,
      sections: [{ sectionPathWithNumber: sectionPath, sectionNumber: 1 }],
    });
    const [lesson] = yield* lsOps.createLessons(section!.id, [
      { lessonPathWithNumber: lessonPath, lessonNumber: 1 },
    ]);
    const video = yield* videoOps.createVideo(lesson!.id, {
      path: "test-video",
      originalFootagePath: "/footage",
    });

    return {
      video,
      course,
      version,
      section: section!,
      lesson: lesson!,
      tempDir,
      lessonDir,
    };
  });

function setupStandaloneDir(videoId: string): string {
  const baseDir =
    process.env.STANDALONE_VIDEO_FILES_DIR || "./standalone-video-files";
  const dir = path.join(baseDir, videoId);
  nodeFs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadVideoPostingContext", () => {
  describe("transcript word count", () => {
    it.effect("computes word count from clips and chapters", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips(
          "test-video",
          ["Hello world.", "This is great.", "Chapter two content."],
          [{ name: "Introduction", afterClipIndex: 0 }]
        );

        setupStandaloneDir(video.id);

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.transcriptWordCount).toBe(10);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("per-chapter word counts", () => {
    it.effect("computes correct word counts per chapter", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips(
          "test-video",
          [
            "one two three",
            "four five",
            "six seven eight nine",
            "ten eleven twelve",
          ],
          [
            { name: "Chapter A", afterClipIndex: 0 },
            { name: "Chapter B", afterClipIndex: 2 },
          ]
        );

        setupStandaloneDir(video.id);

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.chapters).toHaveLength(2);
        expect(ctx.chapters[0]!.name).toBe("Chapter A");
        // "four five" (2) + "six seven eight nine" (4) = 6
        expect(ctx.chapters[0]!.wordCount).toBe(6);
        expect(ctx.chapters[1]!.name).toBe("Chapter B");
        // "ten eleven twelve" (3)
        expect(ctx.chapters[1]!.wordCount).toBe(3);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("standalone file metadata", () => {
    it.effect("returns files with correct extension-based defaultEnabled", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips("test-video", [
          "text",
        ]);

        const dir = setupStandaloneDir(video.id);
        nodeFs.writeFileSync(path.join(dir, "code.ts"), "const x = 1;");
        nodeFs.writeFileSync(path.join(dir, "image.png"), "fake-png-data");
        nodeFs.writeFileSync(path.join(dir, "notes.md"), "# Notes");

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.isStandalone).toBe(true);
        expect(ctx.files).toHaveLength(3);

        const tsFile = ctx.files.find((f) => f.path === "code.ts");
        expect(tsFile).toBeDefined();
        expect(tsFile!.defaultEnabled).toBe(true);

        const pngFile = ctx.files.find((f) => f.path === "image.png");
        expect(pngFile).toBeDefined();
        expect(pngFile!.defaultEnabled).toBe(false);

        const mdFile = ctx.files.find((f) => f.path === "notes.md");
        expect(mdFile).toBeDefined();
        expect(mdFile!.defaultEnabled).toBe(true);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns empty files array when directory does not exist", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips("test-video", [
          "text",
        ]);

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.isStandalone).toBe(true);
        expect(ctx.files).toEqual([]);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("lesson file metadata", () => {
    it.effect(
      "returns lesson files with recursive reading and excluded directory filtering",
      () =>
        Effect.gen(function* () {
          const { video } = yield* createLessonVideo((lessonDir) => {
            nodeFs.writeFileSync(path.join(lessonDir, "index.ts"), "export {}");
            nodeFs.writeFileSync(path.join(lessonDir, "readme.md"), "# Readme");
            nodeFs.mkdirSync(path.join(lessonDir, "node_modules", "pkg"), {
              recursive: true,
            });
            nodeFs.writeFileSync(
              path.join(lessonDir, "node_modules", "pkg", "index.js"),
              "{}"
            );
          });

          const ctx = yield* loadVideoPostingContext(video.id);

          expect(ctx.isStandalone).toBe(false);
          expect(ctx.files.length).toBeGreaterThan(0);

          const tsFile = ctx.files.find((f) => f.path === "index.ts");
          expect(tsFile).toBeDefined();
          expect(tsFile!.defaultEnabled).toBe(true);

          const readmeFile = ctx.files.find((f) => f.path === "readme.md");
          expect(readmeFile).toBeDefined();
          expect(readmeFile!.defaultEnabled).toBe(false);

          const nodeModulesFile = ctx.files.find((f) =>
            f.path.includes("node_modules")
          );
          expect(nodeModulesFile).toBeUndefined();
        }).pipe(Effect.provide(testLayer))
    );
  });

  describe("course structure", () => {
    it.effect(
      "resolves course structure with version matching and fsStatus filtering",
      () =>
        Effect.gen(function* () {
          const { video, section } = yield* createLessonVideo((lessonDir) => {
            nodeFs.writeFileSync(path.join(lessonDir, "index.ts"), "export {}");
          });

          const lsOps = yield* LessonSectionOperationsService;
          yield* lsOps.createGhostLesson(section.id, {
            title: "Ghost Lesson",
            path: "002-ghost-lesson",
            order: 2,
          });

          const ctx = yield* loadVideoPostingContext(video.id);

          expect(ctx.courseStructure).not.toBeNull();
          expect(ctx.courseStructure!.repoName).toBe("test-course");
          expect(ctx.courseStructure!.currentSectionPath).toBe("01-intro");
          expect(ctx.courseStructure!.currentLessonPath).toBe(
            "01.01-getting-started"
          );
          expect(ctx.courseStructure!.sections).toHaveLength(1);

          const sectionResult = ctx.courseStructure!.sections[0]!;
          const realLessons = sectionResult.lessons.filter(
            (l) => l.path === "01.01-getting-started"
          );
          expect(realLessons).toHaveLength(1);
          const ghostLessons = sectionResult.lessons.filter(
            (l) => l.path === "002-ghost-lesson"
          );
          expect(ghostLessons).toHaveLength(0);
        }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns null courseStructure for standalone videos", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips("test-video", [
          "text",
        ]);

        setupStandaloneDir(video.id);

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.courseStructure).toBeNull();
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("empty video edge case", () => {
    it.effect("handles videos with no clips or chapters", () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;
        const video = yield* videoOps.createStandaloneVideo({
          path: "empty-video",
        });

        setupStandaloneDir(video.id);

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.transcriptWordCount).toBe(0);
        expect(ctx.chapters).toEqual([]);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("pitchId", () => {
    it.effect("returns null pitchId for standalone videos", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips("test-video", [
          "text",
        ]);

        setupStandaloneDir(video.id);

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.pitchId).toBeNull();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns null pitchId for lesson videos", () =>
      Effect.gen(function* () {
        const { video } = yield* createLessonVideo((lessonDir) => {
          nodeFs.writeFileSync(path.join(lessonDir, "index.ts"), "export {}");
        });

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.pitchId).toBeNull();
      }).pipe(Effect.provide(testLayer))
    );
  });
});
