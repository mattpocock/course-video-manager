import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
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

let testDb: TestDb;
let finishedVideosDir: string;
let fakeDropbox: ReturnType<typeof createFakeDropbox>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

afterEach(() => {
  fakeDropbox?.cleanup();
});

const DROPBOX_REMOTE_PATH = "/Courses";

const setup = async (opts?: {
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

describe("CoursePublishService — publish", () => {
  it("auto-exports unexported videos and reports the exporting stage", async () => {
    const { course, exportHash, run } = await setup();

    const stages: string[] = [];
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.publish({
          courseId: course.id,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
          onStageChange: (stage) => {
            stages.push(stage);
          },
        });
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
        yield* svc.publish({
          courseId: course.id,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
          onStageChange: (stage) => {
            stages.push(stage);
          },
        });
      })
    );

    expect(stages).not.toContain("exporting");
    expect(stages).toContain("uploading");
  });

  it("Promotes the Pending Version and leaves a fresh Draft on success", async () => {
    const { course, run } = await setup();

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc.publish({
          courseId: course.id,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
        });
        const versionOps = yield* VersionOperationsService;
        const versions = yield* versionOps.getCourseVersions(course.id);
        return { outcome, versions };
      })
    );

    expect(result.versions).toHaveLength(2);
    const published = result.versions.find(
      (v) => v.id === result.outcome.publishedVersionId
    );
    const draft = result.versions.find(
      (v) => v.id === result.outcome.newDraftVersionId
    );
    expect(published).toMatchObject({
      name: "v1.0",
      commitState: "published",
    });
    expect(draft).toMatchObject({ name: "", commitState: "draft" });
  });

  it("Discards the Pending Version after one failed in-flight retry of the Commit", async () => {
    const { course, run } = await setup();

    // Make the receipt upload fail persistently by having the fake Dropbox
    // reject uploads to the course.json path.
    let uploadAttempts = 0;
    const originalFetch = fakeDropbox.handleFetch;
    fakeDropbox.cleanup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.toString()
              : url.url;
        if (
          urlStr.includes("/2/files/upload") &&
          !urlStr.includes("session") &&
          init
        ) {
          const rawArg = (init.headers as Record<string, string>)[
            "Dropbox-API-Arg"
          ];
          const apiArg = rawArg ? JSON.parse(rawArg) : {};
          if (
            apiArg.path?.endsWith("/course.json") &&
            apiArg.mode === "overwrite"
          ) {
            uploadAttempts++;
            return new Response(
              JSON.stringify({ error_summary: "too_many_write_operations/." }),
              { status: 409 }
            );
          }
        }
        return originalFetch(url as any, init);
      })
    );

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc
          .publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: false,
          })
          .pipe(
            Effect.catchTag("PublishCommitFailedError", (error) =>
              Effect.succeed({ error: true as const, errorDetails: error })
            )
          );
        const versionOps = yield* VersionOperationsService;
        const versions = yield* versionOps.getCourseVersions(course.id);
        return { outcome, versions };
      })
    );

    expect(result.outcome).toMatchObject({
      error: true,
      errorDetails: { reason: "sync_failed" },
    });
    // The retry schedule retries the receipt upload (with internal retries
    // for transient errors), then the outer publish retries the whole sync.
    // The Pending Version was auto-Discarded.
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0]).toMatchObject({
      id: (result.outcome as any).errorDetails.newDraftVersionId,
      name: "",
      commitState: "draft",
    });
    expect(
      result.versions.some(
        (v) => v.id === (result.outcome as any).errorDetails.discardedVersionId
      )
    ).toBe(false);
  });

  it("Discards immediately on missing assets, naming the missing videos", async () => {
    const { course, video, exportHash, run } = await setup();

    fs.writeFileSync(
      path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`),
      "data"
    );

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc
          .publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
            onStageChange: (stage) => {
              if (stage === "uploading") {
                fs.rmSync(
                  path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`)
                );
              }
            },
          })
          .pipe(
            Effect.catchTag("PublishCommitFailedError", (error) =>
              Effect.succeed({ error: true as const, errorDetails: error })
            )
          );
        const versionOps = yield* VersionOperationsService;
        const versions = yield* versionOps.getCourseVersions(course.id);
        return { outcome, versions };
      })
    );

    expect(result.outcome).toMatchObject({
      error: true,
      errorDetails: {
        reason: "missing_assets",
        missingVideoIds: [video.id],
      },
    });
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0]).toMatchObject({
      name: "",
      commitState: "draft",
    });
  });

  it("re-syncs the newest Published Version by commit state", async () => {
    const { course, run } = await setup();

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc.publish({
          courseId: course.id,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: false,
        });
        // Delete the remote receipt, then re-sync.
        fakeDropbox.files.delete(
          `${DROPBOX_REMOTE_PATH}/test-course/course.json`.toLowerCase()
        );
        const retry = yield* svc.syncToDropbox(course.id, false);
        const stored = fakeDropbox.get(
          `${DROPBOX_REMOTE_PATH}/test-course/course.json`
        );
        const manifest = JSON.parse(stored!.content.toString("utf-8"));
        return { outcome, retry, manifest };
      })
    );

    expect(result.retry.missingVideos).toEqual([]);
    expect(result.manifest.courseVersionId).toBe(
      result.outcome.publishedVersionId
    );
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
          .publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
          })
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

  it("emits per-video export events and upload progress during publish", async () => {
    const { course, video, run } = await setup();

    const events: Array<{ event: string; data: any }> = [];
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.publish({
          courseId: course.id,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
          onDetailEvent: (e) => {
            events.push({ event: e.event, data: e.data });
          },
        });
      })
    );

    const videosEvent = events.find((e) => e.event === "videos");
    expect(videosEvent?.data.videos).toEqual([
      {
        id: video.id,
        title: expect.stringMatching(/\/Problem$/),
      },
    ]);

    const stages = events
      .filter((e) => e.event === "stage" && e.data.videoId === video.id)
      .map((e) => e.data.stage);
    expect(stages).toEqual([
      "queued",
      "concatenating-clips",
      "normalizing-audio",
    ]);

    expect(
      events.some((e) => e.event === "complete" && e.data.videoId === video.id)
    ).toBe(true);

    const progressEvents = events.filter((e) => e.event === "progress");
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.at(-1)?.data.percentage).toBe(100);
  });

  it("emits a per-video error event and still fails with PublishValidationError", async () => {
    const failingMock = Layer.succeed(VideoProcessingService, {
      exportVideoClips: () => Effect.fail(new Error("ffmpeg crashed")),
    } as any);
    const { course, video, run } = await setup({
      mockVideoProcessing: failingMock,
    });

    const events: Array<{ event: string; data: any }> = [];
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc
          .publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
            onDetailEvent: (e) => {
              events.push({ event: e.event, data: e.data });
            },
          })
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

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent?.data.videoId).toBe(video.id);
    expect(typeof errorEvent?.data.message).toBe("string");
    expect(result).toHaveProperty("error", true);
    expect((result as any).failedExportVideoIds).toContain(video.id);
  });
});
