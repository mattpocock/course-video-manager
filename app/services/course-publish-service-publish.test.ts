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
import {
  clips as clipsTable,
  chapters as chaptersTable,
  videos as videosTable,
} from "@/db/schema";
import { eq } from "drizzle-orm";

let testDb: TestDb;
let finishedVideosDir: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setup = async (opts?: {
  mockVideoProcessing?: Layer.Layer<VideoProcessingService>;
}) => {
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

  // Add chapter and body/description so publish doesn't fail on lints
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
  const exportHash = computeExportHash(clips)!;

  const dropboxDir = fs.mkdtempSync(
    path.join(tmpdir(), "publish-test-dropbox-")
  );

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
        exportOpts.onStageChange?.("normalizing-audio");
        return outputPath;
      }),
  } as any);
  const mockVideoProcessing =
    opts?.mockVideoProcessing ?? defaultMockVideoProcessing;

  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ["FINISHED_VIDEOS_DIRECTORY", finishedVideosDir],
        ["DROPBOX_PATH", dropboxDir],
      ])
    )
  );

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

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(testLayer) as any)
    ) as Promise<A>;

  return { course, version, video, exportHash, run };
};

describe("CoursePublishService — publish", () => {
  it("auto-exports unexported videos and reports the exporting stage", async () => {
    const { course, exportHash, run } = await setup();

    const stages: string[] = [];
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.publish(
          course.id,
          "v1.0",
          "First release",
          true,
          (stage) => {
            stages.push(stage);
          }
        );
      })
    );

    expect(stages).toContain("exporting");
    expect(stages).toContain("uploading");

    const expectedPath = path.join(
      finishedVideosDir,
      `${course.id}-${exportHash}.mp4`
    );
    expect(fs.existsSync(expectedPath)).toBe(true);

    expect(result).toHaveProperty("publishedVersionId");
    expect(result).toHaveProperty("newDraftVersionId");
  });

  it("skips exporting stage when all videos are already exported", async () => {
    const { course, exportHash, run } = await setup();

    fs.writeFileSync(
      path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`),
      "data"
    );

    const stages: string[] = [];
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.publish(
          course.id,
          "v1.0",
          "First release",
          true,
          (stage) => {
            stages.push(stage);
          }
        );
      })
    );

    expect(stages).not.toContain("exporting");
    expect(stages).toContain("uploading");
  });

  it("fails with PublishValidationError when export fails after retries", async () => {
    const failingMock = Layer.succeed(VideoProcessingService, {
      exportVideoClips: () => Effect.fail(new Error("ffmpeg crashed")),
    } as any);
    const { course, video, run } = await setup({
      mockVideoProcessing: failingMock,
    });

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc
          .publish(course.id, "v1.0", "First release", true)
          .pipe(
            Effect.catchTag("PublishValidationError", (e) =>
              Effect.succeed({
                error: true as const,
                failedExportVideoIds: e.failedExportVideoIds,
              })
            )
          );
      })
    );

    expect(result).toHaveProperty("error", true);
    expect((result as any).failedExportVideoIds).toContain(video.id);
  });
});
