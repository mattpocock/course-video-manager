import { describe, it, expect } from "@effect/vitest";
import { afterAll, beforeAll, beforeEach } from "vitest";
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
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { ClipMockupCommentOperationsService } from "@/services/db-clip-mockup-comment-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import {
  loadVideoPostingContext,
  loadWriterContext,
} from "@/services/video-posting-context.server";
import { clipFrame, clipSource } from "@/packages/clip-source";

let testDb: TestDb;
type TestServices =
  | ClipOperationsService
  | VideoOperationsService
  | CourseOperationsService
  | VersionOperationsService
  | LessonSectionOperationsService
  | LinkAuthOperationsService
  | BeatOperationsService
  | ClipMockupOperationsService
  | ClipMockupChapterOperationsService
  | ClipMockupCommentOperationsService
  | DrizzleService
  | FileSystem.FileSystem;

let testLayer: Layer.Layer<TestServices>;

// Video Files go in video-files/ on a temp Storage Root, never the checkout.
let storageRoot: string;
const previousRoots = process.env.STORAGE_ROOTS;
const previousLegacy = process.env.VIDEO_FILES_DIR;

afterAll(() => {
  if (previousRoots === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = previousRoots;
  if (previousLegacy === undefined) delete process.env.VIDEO_FILES_DIR;
  else process.env.VIDEO_FILES_DIR = previousLegacy;
  nodeFs.rmSync(storageRoot, { recursive: true, force: true });
});

beforeAll(async () => {
  storageRoot = nodeFs.mkdtempSync(path.join(tmpdir(), "posting-context-"));
  process.env.STORAGE_ROOTS = storageRoot;
  process.env.VIDEO_FILES_DIR = path.join(storageRoot, "legacy");
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
    BeatOperationsService.Default,
    ClipMockupOperationsService.Default,
    ClipMockupChapterOperationsService.Default,
    ClipMockupCommentOperationsService.Default,
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
    const video = yield* videoOps.createStandaloneVideo({
      title: name,
      format: "landscape",
    });

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
      title: "test-video",
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

function setupVideoDir(lineageId: string): string {
  const baseDir = path.join(storageRoot, "video-files");
  const dir = path.join(baseDir, lineageId);
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

        setupVideoDir(video.lineageId);

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

        setupVideoDir(video.lineageId);

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

        const dir = setupVideoDir(video.lineageId);
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
  });

  describe("course structure", () => {
    it.effect("resolves course structure with version matching", () =>
      Effect.gen(function* () {
        const { video } = yield* createLessonVideo((lessonDir) => {
          nodeFs.writeFileSync(path.join(lessonDir, "index.ts"), "export {}");
        });

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.courseStructure).not.toBeNull();
        expect(ctx.courseStructure!.repoName).toBe("test-course");
        expect(ctx.courseStructure!.currentSectionPath).toBe("intro");
        expect(ctx.courseStructure!.currentLessonPath).toBe("getting-started");
        expect(ctx.courseStructure!.sections).toHaveLength(1);

        const sectionResult = ctx.courseStructure!.sections[0]!;
        expect(sectionResult.lessons).toHaveLength(1);
        expect(sectionResult.lessons[0]!.path).toBe("getting-started");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns null courseStructure for standalone videos", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips("test-video", [
          "text",
        ]);

        setupVideoDir(video.lineageId);

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
          title: "empty-video",
          format: "landscape",
        });

        setupVideoDir(video.lineageId);

        const ctx = yield* loadVideoPostingContext(video.id);

        expect(ctx.transcriptWordCount).toBe(0);
        expect(ctx.chapters).toEqual([]);
      }).pipe(Effect.provide(testLayer))
    );
  });
});

describe("loadWriterContext", () => {
  describe("beats", () => {
    it.effect(
      "includes setup beats alongside other kinds — the Writer's context is author-facing",
      () =>
        Effect.gen(function* () {
          const video = yield* createStandaloneVideoWithClips("test-video", [
            "text",
          ]);

          setupVideoDir(video.lineageId);

          const beatOps = yield* BeatOperationsService;
          yield* beatOps.createBeat(video.id, "setup");
          yield* beatOps.createBeat(video.id, "definition");

          const ctx = yield* loadWriterContext(video.id);

          expect(ctx.beats).toHaveLength(2);
          expect(ctx.beats.map((b) => b.kind).sort()).toEqual([
            "definition",
            "setup",
          ]);
        }).pipe(Effect.provide(testLayer))
    );
  });

  describe("videoRole", () => {
    it.effect("reads the video's role off its title", () =>
      Effect.gen(function* () {
        const problem = yield* createStandaloneVideoWithClips("Problem", ["a"]);
        const solution = yield* createStandaloneVideoWithClips("Solution", [
          "b",
        ]);
        setupVideoDir(problem.lineageId);
        setupVideoDir(solution.lineageId);

        expect((yield* loadWriterContext(problem.id)).videoRole).toBe(
          "problem"
        );
        expect((yield* loadWriterContext(solution.id)).videoRole).toBe(
          "solution"
        );
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("animaticLines", () => {
    it.effect(
      "holds every Animatic line in Animatic order, each with its comments",
      () =>
        Effect.gen(function* () {
          const video = yield* createStandaloneVideoWithClips("test-video", [
            "text",
          ]);
          setupVideoDir(video.lineageId);

          yield* Effect.promise(async () => {
            const [chapter] = await testDb
              .insert(schema.clipMockupChapters)
              .values({ videoId: video.id, name: "Setup", order: "a0" })
              .returning();
            const [, second] = await testDb
              .insert(schema.clipMockups)
              .values(
                ["Hi.", "Here's the problem."].map((line, i) => ({
                  videoId: video.id,
                  line,
                  imagePath: `${i}.png`,
                  audioPath: `${i}.wav`,
                  durationSeconds: 1,
                  order: `a${i + 1}`,
                }))
              )
              .returning();
            await testDb.insert(schema.clipMockupComments).values([
              {
                videoId: video.id,
                clipMockupId: second!.id,
                body: "Stress this.",
              },
              {
                videoId: video.id,
                clipMockupChapterId: chapter!.id,
                body: "Name the repo.",
              },
            ]);
          });

          const ctx = yield* loadWriterContext(video.id);

          expect(
            ctx.animaticLines.map((line) =>
              line.type === "chapter"
                ? [line.name, line.comments]
                : [line.position, line.line, line.comments]
            )
          ).toEqual([
            ["Setup", ["Name the repo."]],
            [1, "Hi.", []],
            [2, "Here's the problem.", ["Stress this."]],
          ]);
        }).pipe(Effect.provide(testLayer))
    );

    it.effect("is empty when the Video has no Clip Mockups", () =>
      Effect.gen(function* () {
        const video = yield* createStandaloneVideoWithClips("test-video", [
          "text",
        ]);
        setupVideoDir(video.lineageId);

        const ctx = yield* loadWriterContext(video.id);

        expect(ctx.animaticLines).toEqual([]);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("indexedClips", () => {
    // What Choose Screenshot captures from: `clipFrame(clipSource(clip), …)`
    // on the Clip it is handed. Its recorded screen, whatever its Layers.
    it.effect(
      "give Choose Screenshot each Clip's recorded screen and face, whatever its Layers",
      () =>
        Effect.gen(function* () {
          const video = yield* createStandaloneVideoWithClips("test-video", [
            "untouched",
            "footage only",
            "several",
          ]);
          setupVideoDir(video.lineageId);

          yield* Effect.promise(async () => {
            const [session] = await testDb
              .insert(schema.recordingSessions)
              .values({
                videoId: video.id,
                cameraFilePath: "/rec/camera.mkv",
                screenFilePath: "/rec/screen.mkv",
                micFilePath: "/rec/mic.wav",
                status: "stopped",
              })
              .returning();
            await testDb.insert(schema.recordingSessionSceneEvents).values({
              recordingSessionId: session!.id,
              fileTime: 0,
              scene: "Code",
            });
            const clips = await testDb
              .update(schema.clips)
              .set({ recordingSessionId: session!.id })
              .returning();
            const byText = (text: string) =>
              clips.find((c) => c.text === text)!.id;
            const footage = (clipId: string, position: number) => ({
              clipId,
              position,
              kind: "footage" as const,
              sessionFile: "camera" as const,
              cropX: 0.25,
              cropY: 0,
              cropW: 0.5,
              cropH: 1,
              placeX: 0,
              placeY: 0,
              placeW: 960,
              placeH: 1080,
              volume: 0,
            });
            await testDb.insert(schema.clipLayers).values([
              footage(byText("footage only"), 0),
              {
                clipId: byText("several"),
                position: 0,
                kind: "scene",
                volume: 1,
              },
              footage(byText("several"), 1),
              {
                ...footage(byText("several"), 2),
                sessionFile: null,
                footagePath: "/footage/b-roll.mp4",
                footageStart: 3,
              },
            ]);
          });

          const ctx = yield* loadWriterContext(video.id);
          const frames = ctx.indexedClips.map((clip) => {
            const source = clipSource(clip);
            const at = clip.sourceStartTime + 1;
            return {
              noFace: clipFrame(source, at, { screenOnly: true }),
              withFace: clipFrame(source, at),
            };
          });

          expect(frames).toHaveLength(3);
          expect(frames[0]!.noFace).toMatchObject({
            kind: "screen",
            screen: "/rec/screen.mkv",
          });
          expect(frames[0]!.withFace).toMatchObject({
            kind: "composite",
            screen: "/rec/screen.mkv",
            camera: "/rec/camera.mkv",
          });
          expect(
            frames.map(({ noFace, withFace }) => [
              { ...noFace, time: 0 },
              { ...withFace, time: 0 },
            ])
          ).toEqual(
            frames.map(() => [
              { ...frames[0]!.noFace, time: 0 },
              { ...frames[0]!.withFace, time: 0 },
            ])
          );
        }).pipe(Effect.provide(testLayer))
    );
  });
});
