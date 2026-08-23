/**
 * Shared test setup for CoursePublishService publish tests.
 *
 * The world it builds is real in almost every respect — real PGlite database
 * with the real schema, real Drizzle query layer, real operations services,
 * real filesystem in a temp directory, real publish logic, real Dropbox auth
 * code path against a seeded auth row — with exactly two fakes: the video
 * processing service (so no encoding occurs) and global fetch (the in-memory
 * Dropbox fake).
 *
 * The fake renderer can be steered per run — see `renderBytes` and
 * `renderDurationInSeconds` — because the interesting Publish defects are about
 * what a renderer PRODUCED, not about what it was asked for.
 */

import { afterEach, beforeAll } from "vitest";
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
import {
  createFakeDropbox,
  FAKE_ACCESS_TOKEN,
} from "@/test-utils/fake-dropbox";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { CoursePublishService } from "@/services/course-publish-service";
import { computeExportHash, type ExportClip } from "@/services/export-hash";
import { SOUND_FAKE_EXPORT_DURATION_IN_SECONDS } from "@/test-utils/fake-video-processing";
import {
  clips as clipsTable,
  chapters as chaptersTable,
  videos as videosTable,
  dropboxAuth,
} from "@/db/schema";
import { eq } from "drizzle-orm";

export let testDb: TestDb;
export let finishedVideosDir: string;
export let fakeDropbox: ReturnType<typeof createFakeDropbox>;

export const DROPBOX_REMOTE_PATH = "/Courses";

/** What the fake renderer writes when a test does not say otherwise. */
export const DEFAULT_RENDERED_BYTES = "dummy-video-content";

/** One run of the fake renderer, as seen by the test that is steering it. */
export type FakeRenderRun = {
  videoId: string;
  /** 1 on this Video's first export, 2 on its next, and so on. */
  runNumber: number;
  /**
   * The total duration this Video's Clips ask for, in seconds — what an honest
   * encode would produce, including the final-clip padding.
   */
  requestedDurationInSeconds: number;
};

/** Register the shared database and fake-Dropbox lifecycle hooks. */
export function setupPublishServiceTests() {
  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  afterEach(() => {
    fakeDropbox?.cleanup();
  });
}

/**
 * A one-Section Course with `videoCount` Lessons, each holding one complete and
 * shippable but not-yet-exported Video — so a Publish has to render every one
 * of them. Clip timings differ per Video, so each has its own Export Hash and
 * therefore its own file in the bundle.
 */
export const setupPublishableCourse = async (opts?: {
  mockVideoProcessing?: Layer.Layer<VideoProcessingService>;
  videoCount?: number;
  config?: Record<string, string>;
  /**
   * The bytes the fake renderer writes. Called once per export, so a Video can
   * be re-exported into DIFFERENT bytes without any of its Clips changing —
   * which is the whole of a re-export.
   *
   * Default: the same fixed string on every run of every Video.
   */
  renderBytes?: (run: FakeRenderRun) => string;
  /**
   * The duration the fake renderer reports for the file it just wrote, in
   * seconds. Returning less than `requestedDurationInSeconds` is a truncated
   * export — the file ffmpeg left behind is shorter than its Clips ask for.
   *
   * Default: exactly what the Clips asked for, i.e. an honest encode.
   */
  renderDurationInSeconds?: (run: FakeRenderRun) => number;
  /**
   * What the fake probe reports for an export ALREADY on disk, in seconds —
   * the file the export step finds at its address and would otherwise skip.
   * Returning less than the Video's Clips ask for is an export that was
   * truncated before anything checked.
   *
   * Default: a duration no test's Clips can exceed, i.e. a sound file.
   */
  measureExportDurationInSeconds?: (probe: { exportPath: string }) => number;
}) => {
  const videoCount = opts?.videoCount ?? 1;
  await truncateAllTables(testDb);

  fakeDropbox = createFakeDropbox();
  fakeDropbox.install();

  finishedVideosDir = fs.mkdtempSync(
    path.join(tmpdir(), "publish-test-videos-")
  );

  // Seed Dropbox auth.
  await testDb.insert(dropboxAuth).values({
    accessToken: FAKE_ACCESS_TOKEN,
    refreshToken: "fake-refresh-token",
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    LinkAuthOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  const course = await Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    return yield* courseOps.createCourse({ name: "test-course" });
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

  // Video n's clips are shifted by n, so every Video gets a distinct Export
  // Hash — and therefore a distinct export file and bundle entry. Video 0's
  // timings are the historical ones, so its Export Hash is stable.
  const clipsForIndex = (index: number): ExportClip[] => [
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10 + index,
      pauseType: "none",
      zoomType: "none",
      overlays: [],
    },
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25 + index,
      pauseType: "none",
      zoomType: "none",
      overlays: [],
    },
  ];

  const videos: Array<{
    id: string;
    title: string;
    lessonPath: string;
    exportHash: string;
    /** Where this Video lands inside the bundle directory. */
    relativeAssetPath: string;
  }> = [];

  for (let index = 0; index < videoCount; index++) {
    const lessonPath = `01.${String(index + 1).padStart(2, "0")}-welcome`;
    const lesson = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      const lessons = yield* lsOps.createLessons(section.id, [
        { lessonPathWithNumber: lessonPath, lessonNumber: index + 1 },
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

    const videoClips = clipsForIndex(index);
    await testDb.insert(clipsTable).values(
      videoClips.map((clip, clipIndex) => ({
        ...clip,
        videoId: video.id,
        order: `a${clipIndex}`,
        text: clipIndex === 0 ? "Hello world" : "Welcome to the course",
        pauseType: "none" as const,
      }))
    );

    await testDb.insert(chaptersTable).values({
      videoId: video.id,
      name: "Introduction",
      order: "a",
    });
    await testDb
      .update(videosTable)
      .set({ body: "Lesson body content", description: "SEO description" })
      .where(eq(videosTable.id, video.id));

    videos.push({
      id: video.id,
      title: video.title,
      lessonPath,
      exportHash: computeExportHash(videoClips, "landscape")!,
      relativeAssetPath: `01-intro/${lessonPath}/${video.title}.mp4`,
    });
  }

  const video = videos[0]!;
  const exportHash = video.exportHash;

  // How many times each Video has been rendered, so a fake renderer can answer
  // differently on a later run.
  const runNumbers = new Map<string, number>();

  const defaultMockVideoProcessing = Layer.succeed(VideoProcessingService, {
    exportVideoClips: (exportOpts: any) =>
      Effect.sync(() => {
        const videoId: string = exportOpts.videoId;
        const runNumber = (runNumbers.get(videoId) ?? 0) + 1;
        runNumbers.set(videoId, runNumber);

        const run: FakeRenderRun = {
          videoId,
          runNumber,
          requestedDurationInSeconds: (
            exportOpts.clips as Array<{ duration: number }>
          ).reduce((total, clip) => total + clip.duration, 0),
        };

        const outputPath = path.join(finishedVideosDir, `${videoId}.mp4`);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(
          outputPath,
          opts?.renderBytes?.(run) ?? DEFAULT_RENDERED_BYTES
        );
        exportOpts.onStageChange?.("concatenating-clips");
        exportOpts.onProgress?.({ stage: "concatenating-clips", percent: 50 });
        exportOpts.onProgress?.({ stage: "concatenating-clips", percent: 99 });
        exportOpts.onStageChange?.("normalizing-audio");
        exportOpts.onProgress?.({ stage: "normalizing-audio", percent: 50 });
        return {
          outputPath,
          durationInSeconds:
            opts?.renderDurationInSeconds?.(run) ??
            run.requestedDurationInSeconds,
        };
      }),
    getVideoDurationInSeconds: (exportPath: string) =>
      Effect.sync(
        () =>
          opts?.measureExportDurationInSeconds?.({ exportPath }) ??
          SOUND_FAKE_EXPORT_DURATION_IN_SECONDS
      ),
  } as any);
  const mockVideoProcessing =
    opts?.mockVideoProcessing ?? defaultMockVideoProcessing;

  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ["FINISHED_VIDEOS_DIRECTORY", finishedVideosDir],
        ["DROPBOX_REMOTE_PATH", DROPBOX_REMOTE_PATH],
        ...Object.entries(opts?.config ?? {}),
      ])
    )
  );

  const coreTestLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LinkAuthOperationsService.Default,
    mockVideoProcessing,
    NodeContext.layer
  ).pipe(Layer.provide(drizzleLayer), Layer.provide(configLayer));

  const testLayer = Layer.merge(
    coreTestLayer,
    CoursePublishService.Default.pipe(Layer.provide(coreTestLayer))
  );

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(testLayer) as any)
    ) as Promise<A>;

  return { course, version, video, videos, exportHash, run };
};
