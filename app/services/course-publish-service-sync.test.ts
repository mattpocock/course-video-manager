import { describe, it, expect, beforeAll, afterEach } from "vitest";
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
import {
  computeExportHash,
  resolveExportPath,
  type ExportClip,
} from "@/services/export-hash";
import {
  clips as clipsTable,
  videos as videosTable,
  dropboxAuth,
} from "@/db/schema";
import { fromPartial } from "@total-typescript/shoehorn";
import { eq } from "drizzle-orm";

let testDb: TestDb;
let finishedVideosDir: string;
let fakeDropbox: ReturnType<typeof createFakeDropbox>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const DROPBOX_REMOTE_PATH = "/Courses";

const setupSync = async () => {
  await truncateAllTables(testDb);

  fakeDropbox = createFakeDropbox();
  fakeDropbox.install();

  finishedVideosDir = fs.mkdtempSync(path.join(tmpdir(), "sync-test-videos-"));

  // Seed Dropbox auth so the transport can get an access token.
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

  const mockVideoProcessing = Layer.succeed(
    VideoProcessingService,
    fromPartial({
      exportVideoClips: (opts: any) =>
        Effect.sync(() => {
          const outputPath = path.join(
            finishedVideosDir,
            `${opts.videoId}.mp4`
          );
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, "dummy-video-content");
          return outputPath;
        }),
    })
  );

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
      name: "",
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

  const lesson1 = await Effect.gen(function* () {
    const lsOps = yield* LessonSectionOperationsService;
    const lessons = yield* lsOps.createLessons(section.id, [
      { lessonPathWithNumber: "01.01-welcome", lessonNumber: 1 },
    ]);
    yield* lsOps.updateLesson(lessons[0]!.id, { authoringStatus: "done" });
    return lessons[0]!;
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const lesson2 = await Effect.gen(function* () {
    const lsOps = yield* LessonSectionOperationsService;
    const lessons = yield* lsOps.createLessons(section.id, [
      { lessonPathWithNumber: "01.02-setup", lessonNumber: 2 },
    ]);
    return lessons[0]!;
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const video1 = await Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    return yield* videoOps.createVideo(lesson1.id, {
      title: "Problem",
      originalFootagePath: "/tmp/footage1.mp4",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const video2 = await Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    return yield* videoOps.createVideo(lesson2.id, {
      title: "Explainer",
      originalFootagePath: "/tmp/footage2.mp4",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  await testDb
    .update(videosTable)
    .set({ body: "Video body", description: "Video description" })
    .where(eq(videosTable.id, video1.id));
  await testDb
    .update(videosTable)
    .set({ body: "Video body", description: "Video description" })
    .where(eq(videosTable.id, video2.id));

  const clipData = [
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a0",
      text: "Hello world",
      pauseType: "none" as const,
    },
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25,
      order: "a1",
      text: "Welcome to the course",
      pauseType: "none" as const,
    },
  ];

  await testDb
    .insert(clipsTable)
    .values(clipData.map((c) => ({ ...c, videoId: video1.id })));
  await testDb
    .insert(clipsTable)
    .values(clipData.map((c) => ({ ...c, videoId: video2.id })));

  const clips: ExportClip[] = clipData.map((c) => ({
    videoFilename: c.videoFilename,
    sourceStartTime: c.sourceStartTime,
    sourceEndTime: c.sourceEndTime,
    order: c.order,
  }));
  const exportHash = computeExportHash(clips, "landscape")!;

  fs.writeFileSync(
    resolveExportPath(finishedVideosDir, course.id, exportHash),
    "video-content"
  );

  await Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    yield* versionOps.copyVersionStructure({
      sourceVersionId: version.id,
      repoId: course.id,
      newVersionName: "",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

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

  return { course, version, video1, video2, run };
};

afterEach(() => {
  fakeDropbox?.cleanup();
});

function getRemoteManifest(): any {
  const stored = fakeDropbox.get(
    `${DROPBOX_REMOTE_PATH}/test-course/course.json`
  );
  if (!stored) throw new Error("No course.json in fake Dropbox");
  return JSON.parse(stored.content.toString("utf-8"));
}

function getManifestVideos(doc: any): Array<{ relativePath: string }> {
  return doc.sections.flatMap((section: any) =>
    section.lessons.flatMap((lesson: any) =>
      lesson.type === "problem"
        ? [lesson.problem, lesson.solution].filter(Boolean)
        : [lesson.explainer]
    )
  );
}

describe("CoursePublishService.syncToDropbox (Dropbox HTTP API)", () => {
  it("uploads video files to Dropbox", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = getRemoteManifest();
    for (const video of getManifestVideos(doc)) {
      const fullPath = `${DROPBOX_REMOTE_PATH}/test-course/${video.relativePath}`;
      expect(fakeDropbox.get(fullPath)).toBeDefined();
    }
  });

  it("uploads videos for all lessons", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = getRemoteManifest();
    const videos = getManifestVideos(doc);
    expect(videos).toHaveLength(2);
    for (const video of videos) {
      const fullPath = `${DROPBOX_REMOTE_PATH}/test-course/${video.relativePath}`;
      expect(fakeDropbox.get(fullPath)).toBeDefined();
    }
  });

  it("verifies existing bundle integrity via content_hash + size", async () => {
    const { course, run } = await setupSync();

    // First sync creates the bundle.
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    // Second sync verifies the existing bundle without re-uploading.
    const callsBefore = fakeDropbox.fetchCalls.length;
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    // Should have made API calls for metadata/listing but no upload calls
    // for the bundle videos (only the receipt overwrite).
    const uploadCalls = fakeDropbox.fetchCalls
      .slice(callsBefore)
      .filter((c) => {
        if (!c.url.includes("/2/files/upload") || c.url.includes("session"))
          return false;
        const apiArg = (c.init.headers as Record<string, string>)[
          "Dropbox-API-Arg"
        ];
        return apiArg && JSON.parse(apiArg).path.includes("versions/");
      });
    expect(uploadCalls).toHaveLength(0);
  });

  it("rejects bundle corruption without moving the commit marker", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const manifestBefore = getRemoteManifest();
    // Corrupt a video in the fake Dropbox.
    const firstVideo = getManifestVideos(manifestBefore)[0]!;
    const fullPath = `${DROPBOX_REMOTE_PATH}/test-course/${firstVideo.relativePath}`;
    const stored = fakeDropbox.get(fullPath)!;
    // Replace with same-sized but different content.
    fakeDropbox.store(
      stored.pathDisplay,
      Buffer.from("x".repeat(stored.content.length))
    );

    await expect(
      run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          yield* svc.syncToDropbox(course.id, true);
        })
      )
    ).rejects.toBeDefined();

    // Manifest should be unchanged.
    const manifestAfter = getRemoteManifest();
    expect(manifestAfter).toEqual(manifestBefore);
  });

  it("writes only .mp4, course.json, manifest.json, and course.schema.json — no authoring sidecars", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = getRemoteManifest();
    const coursePrefix = `${DROPBOX_REMOTE_PATH}/test-course/`;
    const prefix = coursePrefix.toLowerCase();
    const remoteFiles = Array.from(fakeDropbox.files.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) =>
        fakeDropbox.files.get(k)!.pathDisplay.slice(coursePrefix.length)
      )
      .sort();

    const expectedFiles = [
      "course.json",
      `${doc.$schema}`,
      `${path.posix.dirname(doc.$schema)}/manifest.json`,
      ...getManifestVideos(doc).map((video) => video.relativePath),
    ].sort();

    expect(remoteFiles).toEqual(expectedFiles);
  });

  it("emits per-lesson progress events", async () => {
    const { course, run } = await setupSync();

    const events: Array<{ event: string; data: unknown }> = [];
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true, (event, data) => {
          events.push({ event, data });
        });
      })
    );

    const progressEvents = events.filter((e) => e.event === "progress");
    expect(progressEvents.length).toBeGreaterThan(0);
    const lastProgress = progressEvents[progressEvents.length - 1];
    expect((lastProgress?.data as any)?.percentage).toBe(100);
  });

  it("returns missingVideos without writing an incomplete manifest", async () => {
    const { course, run } = await setupSync();

    const files = fs.readdirSync(finishedVideosDir);
    for (const file of files) {
      fs.unlinkSync(path.join(finishedVideosDir, file));
    }

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncToDropbox(course.id, true);
      })
    );

    expect(result.missingVideos.length).toBeGreaterThan(0);
    expect(
      fakeDropbox.get(`${DROPBOX_REMOTE_PATH}/test-course/course.json`)
    ).toBeUndefined();
  });

  it("emits course.json at the course root", async () => {
    const { course, version, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = getRemoteManifest();
    expect(doc.schemaVersion).toBe(3);
    expect(doc.courseId).toBe(course.id);
    expect(doc.courseVersionId).toBe(version.id);
    expect(doc.archiveTTL).toBe("90d");
    expect(doc.courseName).toBe("test-course");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].lessons).toHaveLength(2);
  });

  it("course.json contains no path field", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = getRemoteManifest();
    expect(doc.sections[0]).not.toHaveProperty("path");
    const lesson = doc.sections[0].lessons[0];
    expect(lesson).not.toHaveProperty("path");
    const video = lesson.problem ?? lesson.explainer;
    expect(video).not.toHaveProperty("path");
  });

  it("course.json uses lineageId as correlation id", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = getRemoteManifest();
    const lesson = doc.sections[0].lessons[0];
    expect(lesson.id).toBeDefined();
    expect(lesson.id).not.toBe("");
    expect(lesson.explainer?.id ?? lesson.problem?.id).toBeDefined();
  });

  it("course.json includes the render-input hash and exported byte receipt", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = getRemoteManifest();
    const lesson = doc.sections[0].lessons[0];
    const video = lesson.problem ?? lesson.explainer;
    expect(video.hash).not.toBeNull();
    expect(typeof video.hash).toBe("string");
    expect(video.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(video.bytes).toBe(Buffer.byteLength("video-content"));
  });

  it("does not resolve or publish archived videos", async () => {
    const { course, video2, run } = await setupSync();
    await testDb
      .update(clipsTable)
      .set({ sourceEndTime: 99 })
      .where(eq(clipsTable.videoId, video2.id));
    await testDb
      .update(videosTable)
      .set({ archived: true })
      .where(eq(videosTable.id, video2.id));

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncToDropbox(course.id, true);
      })
    );

    expect(result.missingVideos).toEqual([]);
    const videos = getManifestVideos(getRemoteManifest());
    expect(videos).toHaveLength(1);
    expect(videos[0]!.relativePath).not.toContain("01.02-setup");
  });

  // ── Withholding to-do lessons (includeTodoLessons = false) ──────────

  it("withholds a to-do lesson's folder and omits it from course.json", async () => {
    const { course, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, false);
      })
    );

    const doc = getRemoteManifest();
    const videos = getManifestVideos(doc);
    expect(videos).toHaveLength(1);
    expect(videos[0]!.relativePath).toContain("01.01-welcome/Problem.mp4");
    const fullPath = `${DROPBOX_REMOTE_PATH}/test-course/${videos[0]!.relativePath}`;
    expect(fakeDropbox.get(fullPath)).toBeDefined();
    expect(videos[0]!.relativePath).not.toContain("01.02-setup");

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].lessons).toHaveLength(1);
  });

  it("keeps the prior immutable bundle when a later manifest withholds a to-do lesson", async () => {
    const { course, run } = await setupSync();

    // First publish includes the to-do lesson.
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );
    const firstDoc = getRemoteManifest();
    const previousTodoVideo = getManifestVideos(firstDoc).find((video) =>
      video.relativePath.includes("01.02-setup")
    )!;
    const previousTodoPath = `${DROPBOX_REMOTE_PATH}/test-course/${previousTodoVideo.relativePath}`;
    expect(fakeDropbox.get(previousTodoPath)).toBeDefined();

    // A later publish withholds it.
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, false);
      })
    );
    const secondDoc = getRemoteManifest();
    expect(
      getManifestVideos(secondDoc).some((video) =>
        video.relativePath.includes("01.02-setup")
      )
    ).toBe(false);
    // The prior bundle's files are still in Dropbox.
    expect(fakeDropbox.get(previousTodoPath)).toBeDefined();
  });
});
