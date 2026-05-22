import { describe, it, expect, beforeAll } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { CoursePublishService } from "@/services/course-publish-service";
import { computeExportHash, type ExportClip } from "@/services/export-hash";
import { clips as clipsTable } from "@/db/schema";

let testDb: TestDb;
let finishedVideosDir: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

/** Create temp directories and seed a course with one version, one section,
 *  one lesson, one video with clips in the PGLite database. Returns IDs. */
const setup = async () => {
  await truncateAllTables(testDb);

  finishedVideosDir = fs.mkdtempSync(
    path.join(tmpdir(), "publish-test-videos-")
  );

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  // Mock VideoProcessingService: creates a dummy file at {videoId}.mp4
  const mockVideoProcessing = Layer.succeed(VideoProcessingService, {
    exportVideoClips: (opts: any) =>
      Effect.sync(() => {
        const outputPath = path.join(finishedVideosDir, `${opts.videoId}.mp4`);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, "dummy-video-content");
        opts.onStageChange?.("concatenating-clips");
        opts.onStageChange?.("normalizing-audio");
        return outputPath;
      }),
  } as any);

  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([["FINISHED_VIDEOS_DIRECTORY", finishedVideosDir]])
    )
  );

  // Build a core layer with all deps, then provide to CoursePublishService
  const coreTestLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    mockVideoProcessing,
    NodeContext.layer
  ).pipe(Layer.provide(drizzleLayer), Layer.provide(configLayer));

  const testLayer = Layer.merge(
    coreTestLayer,
    CoursePublishService.Default.pipe(Layer.provide(coreTestLayer))
  );

  // Seed data
  const course = await Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    return yield* courseOps.createCourse({
      filePath: "/tmp/test-course",
      name: "test-course",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const version = await Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    return yield* versionOps.createCourseVersion({
      repoId: course.id,
      name: "v1",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const section = await Effect.gen(function* () {
    const lsOps = yield* LessonSectionOperationsService;
    const sections = yield* lsOps.createSections({
      repoVersionId: version.id,
      sections: [{ sectionPathWithNumber: "01-intro", sectionNumber: 1 }],
    });
    return sections[0]!;
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const lesson = await Effect.gen(function* () {
    const lsOps = yield* LessonSectionOperationsService;
    const lessons = yield* lsOps.createLessons(section.id, [
      { lessonPathWithNumber: "01.01-welcome", lessonNumber: 1 },
    ]);
    return lessons[0]!;
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const video = await Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    return yield* videoOps.createVideo(lesson.id, {
      path: "Problem",
      originalFootagePath: "/tmp/footage.mp4",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  // Add clips to the video (direct insert)
  await testDb.insert(clipsTable).values([
    {
      videoId: video.id,
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a0",
      text: "Hello world",
      beatType: "none",
    },
    {
      videoId: video.id,
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25,
      order: "a1",
      text: "Welcome to the course",
      beatType: "none",
    },
  ]);

  const clips: ExportClip[] = [
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a0",
    },
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25,
      order: "a1",
    },
  ];
  const exportHash = computeExportHash(clips)!;

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(testLayer) as any)
    ) as Promise<A>;

  return {
    course,
    version,
    section,
    lesson,
    video,
    exportHash,
    clips,
    run,
    testLayer,
    dbLayer,
  };
};

describe("CoursePublishService", () => {
  describe("isExported", () => {
    it("returns false when no file exists", async () => {
      const { video, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.isExported(video.id);
        })
      );

      expect(result).toBe(false);
    });

    it("returns true when content-addressed file exists", async () => {
      const { video, course, exportHash, run } = await setup();

      // Create the content-addressed file
      const filePath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      fs.writeFileSync(filePath, "video-data");

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.isExported(video.id);
        })
      );

      expect(result).toBe(true);
    });

    it("accepts a video object and returns false when no file exists", async () => {
      const { video, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const videoOps = yield* VideoOperationsService;
          const svc = yield* CoursePublishService;
          const fullVideo = yield* videoOps.getVideoWithClipsById(video.id);
          return yield* svc.isExported(fullVideo);
        })
      );

      expect(result).toBe(false);
    });

    it("accepts a video object and returns true when file exists", async () => {
      const { video, course, exportHash, run } = await setup();

      const filePath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      fs.writeFileSync(filePath, "video-data");

      const result = await run(
        Effect.gen(function* () {
          const videoOps = yield* VideoOperationsService;
          const svc = yield* CoursePublishService;
          const fullVideo = yield* videoOps.getVideoWithClipsById(video.id);
          return yield* svc.isExported(fullVideo);
        })
      );

      expect(result).toBe(true);
    });
  });

  describe("resolveExportPath", () => {
    it("returns content-addressed path for video with clips", async () => {
      const { video, course, exportHash, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.resolveExportPath(video.id);
        })
      );

      expect(result).toBe(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`)
      );
    });

    it("accepts a video object and returns content-addressed path", async () => {
      const { video, course, exportHash, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const videoOps = yield* VideoOperationsService;
          const svc = yield* CoursePublishService;
          const fullVideo = yield* videoOps.getVideoWithClipsById(video.id);
          return yield* svc.resolveExportPath(fullVideo);
        })
      );

      expect(result).toBe(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`)
      );
    });
  });

  describe("exportVideo", () => {
    it("exports video to content-addressed path", async () => {
      const { video, course, exportHash, run } = await setup();

      const stages: string[] = [];
      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.exportVideo(video.id, (stage) => {
            stages.push(stage);
          });
        })
      );

      const expectedPath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      expect(result).toBe(expectedPath);
      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(stages).toContain("concatenating-clips");
      expect(stages).toContain("normalizing-audio");
    });

    it("skips rendering if already exported", async () => {
      const { video, course, exportHash, run } = await setup();

      // Pre-create the content-addressed file
      const expectedPath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      fs.writeFileSync(expectedPath, "already-exported");

      const stages: string[] = [];
      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.exportVideo(video.id, (stage) => {
            stages.push(stage);
          });
        })
      );

      expect(result).toBe(expectedPath);
      // Should NOT have called ffmpeg (no stage events)
      expect(stages).toEqual([]);
      // File content should be unchanged (not re-rendered)
      expect(fs.readFileSync(expectedPath, "utf-8")).toBe("already-exported");
    });
  });

  describe("validatePublishability", () => {
    it("returns unexported video IDs when videos are not exported", async () => {
      const { version, video, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.validatePublishability(version.id);
        })
      );

      expect(result.unexportedVideoIds).toContain(video.id);
    });

    it("returns empty list when all videos are exported", async () => {
      const { version, course, exportHash, run } = await setup();

      // Create the exported file
      fs.writeFileSync(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`),
        "data"
      );

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.validatePublishability(version.id);
        })
      );

      expect(result.unexportedVideoIds).toEqual([]);
    });
  });

  describe("batchExport", () => {
    it("exports all unexported videos in a version", async () => {
      const { version, course, exportHash, run } = await setup();

      const events: Array<{ event: string; data: unknown }> = [];
      await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          yield* svc.batchExport(version.id, (event, data) => {
            events.push({ event, data });
          });
        })
      );

      // Should have exported the video
      const expectedPath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      expect(fs.existsSync(expectedPath)).toBe(true);

      // Should have sent events
      const videosEvent = events.find((e) => e.event === "videos");
      expect(videosEvent).toBeTruthy();
      const completeEvent = events.find((e) => e.event === "complete");
      expect(completeEvent).toBeTruthy();
    });

    it("skips already exported videos", async () => {
      const { version, course, exportHash, run } = await setup();

      // Pre-create the exported file
      fs.writeFileSync(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`),
        "data"
      );

      const events: Array<{ event: string; data: unknown }> = [];
      await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          yield* svc.batchExport(version.id, (event, data) => {
            events.push({ event, data });
          });
        })
      );

      // Should report zero unexported videos
      const videosEvent = events.find((e) => e.event === "videos");
      expect((videosEvent?.data as any)?.videos).toEqual([]);
    });
  });

  describe("exportVideo → isExported integration", () => {
    it("isExported returns true after exportVideo", async () => {
      const { video, run } = await setup();

      // Initially not exported
      const beforeExport = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.isExported(video.id);
        })
      );
      expect(beforeExport).toBe(false);

      // Export
      await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          yield* svc.exportVideo(video.id);
        })
      );

      // Now exported
      const afterExport = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.isExported(video.id);
        })
      );
      expect(afterExport).toBe(true);
    });
  });

  describe("export → validatePublishability integration", () => {
    it("validatePublishability passes after all videos exported", async () => {
      const { version, video, run } = await setup();

      // Before export: validation fails
      const before = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.validatePublishability(version.id);
        })
      );
      expect(before.unexportedVideoIds).toContain(video.id);

      // Export video
      await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          yield* svc.exportVideo(video.id);
        })
      );

      // After export: validation passes
      const after = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.validatePublishability(version.id);
        })
      );
      expect(after.unexportedVideoIds).toEqual([]);
    });
  });

  describe("publish", () => {
    it("fails with PublishValidationError when videos are unexported", async () => {
      const { course, video, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.publish(course.id, "v1.0", "First release").pipe(
            Effect.catchTag("PublishValidationError", (e) =>
              Effect.succeed({
                error: true,
                unexportedVideoIds: e.unexportedVideoIds,
              })
            )
          );
        })
      );

      expect((result as any).error).toBe(true);
      expect((result as any).unexportedVideoIds).toContain(video.id);
    });
  });
});
