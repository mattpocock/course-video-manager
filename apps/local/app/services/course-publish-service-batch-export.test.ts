// batchExport's slice of CoursePublishService — split out of
// course-publish-service.test.ts, which covers the rest of the service. The
// seeded fixture below is the same one, kept local per this repo's per-file
// test-harness convention (see course-publish-service-publish.test.ts).
import { describe, it, expect, beforeAll } from "vitest";
import { writeAlreadyExportedVideo } from "@/test-utils/exported-video-fixture";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { fakeOverlayRenderCacheLayer } from "@/test-utils/fake-overlay-render-cache";
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
import {
  honestRenderedDurationInSeconds,
  soundExportDurationProbe,
} from "@/test-utils/fake-video-processing";

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
        opts.onProgress?.({ stage: "concatenating-clips", percent: 50 });
        opts.onStageChange?.("normalizing-audio");
        opts.onProgress?.({ stage: "normalizing-audio", percent: 50 });
        return {
          outputPath,
          durationInSeconds: honestRenderedDurationInSeconds(opts),
        };
      }),
    getVideoDurationInSeconds: soundExportDurationProbe,
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
    fakeOverlayRenderCacheLayer(),
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
      title: "Problem",
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
      pauseType: "none",
      zoomType: "none",
    },
    {
      videoId: video.id,
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25,
      order: "a1",
      text: "Welcome to the course",
      pauseType: "none",
      zoomType: "none",
    },
  ]);

  const clips: ExportClip[] = [
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      pauseType: "none",
      zoomType: "none",
      overlays: [],
    },
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25,
      pauseType: "none",
      zoomType: "none",
      overlays: [],
    },
  ];
  const exportHash = computeExportHash(clips, "landscape")!;

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

type Setup = Awaited<ReturnType<typeof setup>>;

/** Seed a Video with one Clip per entry in `clipDurations` (seconds), so a
 *  Video's length can be spread over however many Clips a test needs. */
const addVideo = async (
  { lesson, dbLayer }: Setup,
  title: string,
  clipDurations: number[]
) => {
  const created = await Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    return yield* videoOps.createVideo(lesson.id, {
      title,
      originalFootagePath: "/tmp/footage.mp4",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  let sourceStartTime = 0;
  await testDb.insert(clipsTable).values(
    clipDurations.map((duration, index) => {
      const clip = {
        videoId: created.id,
        videoFilename: `${title}.mp4`,
        sourceStartTime,
        sourceEndTime: sourceStartTime + duration,
        order: `a${index}`,
        text: title,
        pauseType: "none",
        zoomType: "none",
      };
      // Leave a gap, so the spans read as distinct takes from one recording.
      sourceStartTime += duration + 1;
      return clip;
    })
  );
  return created;
};

/** Run a batch export, collecting every emitted event. */
const runBatchExport = async ({ version, run }: Setup) => {
  const events: Array<{ event: string; data: any }> = [];
  await run(
    Effect.gen(function* () {
      const svc = yield* CoursePublishService;
      yield* svc.batchExport(version.id, true, (e) => {
        events.push({ event: e.event, data: e.data });
      });
    })
  );
  return events;
};

/** The titles of the announced queue, in the order the run will work through
 *  them. */
const announcedTitles = (events: Array<{ event: string; data: any }>) =>
  events
    .find((e) => e.event === "videos")
    ?.data.videos.map((v: any) => v.title);

describe("CoursePublishService", () => {
  describe("batchExport", () => {
    it("exports all unexported videos in a version", async () => {
      const context = await setup();
      const { course, exportHash } = context;

      const events = await runBatchExport(context);

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

      // Real ffmpeg percentages ride alongside the stages, keyed by videoId.
      const progressEvents = events
        .filter((e) => e.event === "video-progress")
        .map((e) => e.data as any);
      expect(progressEvents).toEqual([
        expect.objectContaining({ stage: "concatenating-clips", percent: 50 }),
        expect.objectContaining({ stage: "normalizing-audio", percent: 50 }),
      ]);
      expect(progressEvents[0].videoId).toBeTruthy();
    });

    it("begins the longest videos first", async () => {
      const context = await setup();

      // Titles chosen so the walk order (sections → lessons → title asc) is
      // "A Tiny", "B Long", "Problem" — nothing like the longest-first order.
      await addVideo(context, "A Tiny", [2]);
      await addVideo(context, "B Long", [300]);

      const events = await runBatchExport(context);

      // "Problem" is the 20s video seeded by setup().
      expect(announcedTitles(events)).toEqual([
        "01-intro/01.01-welcome/B Long",
        "01-intro/01.01-welcome/Problem",
        "01-intro/01.01-welcome/A Tiny",
      ]);
    });

    it("measures a video's length across all of its clips", async () => {
      const context = await setup();

      // Six 20s clips outrun a single 100s one, though every clip in the
      // longer Video is individually the shorter of the two. Titled so the
      // walk order puts the longest Video last.
      await addVideo(context, "Z Many Short", Array(6).fill(20));
      await addVideo(context, "A One Long", [100]);

      const events = await runBatchExport(context);

      expect(announcedTitles(events)).toEqual([
        "01-intro/01.01-welcome/Z Many Short",
        "01-intro/01.01-welcome/A One Long",
        "01-intro/01.01-welcome/Problem",
      ]);
    });

    it("skips already exported videos", async () => {
      const context = await setup();
      const { course, exportHash } = context;

      // Pre-create the exported file
      writeAlreadyExportedVideo(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`),
        "data"
      );

      const events = await runBatchExport(context);

      // Should report zero unexported videos
      expect(announcedTitles(events)).toEqual([]);
    });
  });
});
