/**
 * Shared test setup for CoursePublishService publish tests.
 *
 * The world it builds is real in almost every respect — real PGlite database
 * with the real schema, real Drizzle query layer, real operations services,
 * real filesystem in a temp directory, real publish logic, real Dropbox auth
 * code path against a seeded auth row — with exactly two fakes: the video
 * processing service (so no encoding occurs) and global fetch (the in-memory
 * Dropbox fake).
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
 * A one-Section, one-Lesson, one-Video Course whose single Video is complete
 * and shippable but not yet exported — so a Publish has to render it.
 */
export const setupPublishableCourse = async (opts?: {
  mockVideoProcessing?: Layer.Layer<VideoProcessingService>;
}) => {
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

  await testDb.insert(clipsTable).values([
    {
      videoId: video.id,
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a0",
      text: "Hello world",
      pauseType: "none",
    },
    {
      videoId: video.id,
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25,
      order: "a1",
      text: "Welcome to the course",
      pauseType: "none",
    },
  ]);

  await testDb.insert(chaptersTable).values({
    videoId: video.id,
    name: "Introduction",
    order: "a",
  });
  await testDb
    .update(videosTable)
    .set({ body: "Lesson body content", description: "SEO description" })
    .where(eq(videosTable.id, video.id));

  const clips: ExportClip[] = [
    { videoFilename: "recording.mp4", sourceStartTime: 0, sourceEndTime: 10 },
    { videoFilename: "recording.mp4", sourceStartTime: 15, sourceEndTime: 25 },
  ];
  const exportHash = computeExportHash(clips, "landscape")!;

  const defaultMockVideoProcessing = Layer.succeed(VideoProcessingService, {
    exportVideoClips: (exportOpts: any) =>
      Effect.sync(() => {
        const outputPath = path.join(
          finishedVideosDir,
          `${exportOpts.videoId}.mp4`
        );
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, "dummy-video-content");
        exportOpts.onStageChange?.("concatenating-clips");
        exportOpts.onProgress?.({ stage: "concatenating-clips", percent: 50 });
        exportOpts.onProgress?.({ stage: "concatenating-clips", percent: 99 });
        exportOpts.onStageChange?.("normalizing-audio");
        exportOpts.onProgress?.({ stage: "normalizing-audio", percent: 50 });
        return outputPath;
      }),
  } as any);
  const mockVideoProcessing =
    opts?.mockVideoProcessing ?? defaultMockVideoProcessing;

  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ["FINISHED_VIDEOS_DIRECTORY", finishedVideosDir],
        ["DROPBOX_REMOTE_PATH", DROPBOX_REMOTE_PATH],
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

  return { course, version, video, exportHash, run };
};
