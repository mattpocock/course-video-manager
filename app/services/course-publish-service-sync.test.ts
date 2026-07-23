import { describe, it, expect, beforeAll } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
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
import {
  computeExportHash,
  resolveExportPath,
  type ExportClip,
} from "@/services/export-hash";
import { clips as clipsTable, videos as videosTable } from "@/db/schema";
import { fromPartial } from "@total-typescript/shoehorn";
import { eq } from "drizzle-orm";

let testDb: TestDb;
let finishedVideosDir: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setupSync = async (options?: {
  // Wrap the real FileSystem service — used to fault-inject the sync-client
  // lock contention (EACCES on rename) the Dropbox client causes in production.
  wrapFileSystem?: (real: FileSystem.FileSystem) => FileSystem.FileSystem;
  publishStagingDir?: string;
}) => {
  await truncateAllTables(testDb);

  finishedVideosDir = fs.mkdtempSync(path.join(tmpdir(), "sync-test-videos-"));
  const dropboxDir = fs.mkdtempSync(path.join(tmpdir(), "sync-test-dropbox-"));

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
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

  // lesson1: authoringStatus "done"
  const lesson1 = await Effect.gen(function* () {
    const lsOps = yield* LessonSectionOperationsService;
    const lessons = yield* lsOps.createLessons(section.id, [
      { lessonPathWithNumber: "01.01-welcome", lessonNumber: 1 },
    ]);
    yield* lsOps.updateLesson(lessons[0]!.id, { authoringStatus: "done" });
    return lessons[0]!;
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  // lesson2: authoringStatus "todo" (default)
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

  // Every shipping Video needs a body and description to publish (see ADR 0019).
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

  // Freeze the populated version by creating the next editable Draft. The
  // Dropbox sync surface only accepts a non-latest Course Version.
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
        ["DROPBOX_PATH", dropboxDir],
        ...(options?.publishStagingDir
          ? [["PUBLISH_STAGING_DIR", options.publishStagingDir] as const]
          : []),
      ])
    )
  );

  const fsOverrideLayer = options?.wrapFileSystem
    ? Layer.effect(
        FileSystem.FileSystem,
        Effect.map(FileSystem.FileSystem, options.wrapFileSystem)
      ).pipe(Layer.provide(NodeContext.layer))
    : Layer.empty;

  const coreTestLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    mockVideoProcessing,
    NodeContext.layer,
    fsOverrideLayer
  ).pipe(Layer.provide(drizzleLayer), Layer.provide(configLayer));

  const testLayer = Layer.merge(
    coreTestLayer,
    CoursePublishService.Default.pipe(Layer.provide(coreTestLayer))
  );

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(testLayer) as any)
    ) as Promise<A>;

  return { course, version, video1, video2, dropboxDir, run };
};

describe("CoursePublishService.syncToDropbox", () => {
  it("copies video files to dropbox", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const courseDir = path.join(dropboxDir, "test-course");
    const doc = readCourseManifest(courseDir);
    for (const video of getManifestVideos(doc)) {
      expect(
        fs.existsSync(path.join(courseDir, ...video.relativePath.split("/")))
      ).toBe(true);
    }
  });

  it("retries the bundle rename through transient sync-client locks", async () => {
    // The Dropbox client holds handles on files it is indexing, so on
    // Windows-backed mounts the staging → bundle dir rename fails with EACCES
    // until the client lets go. The commit must ride out the contention
    // instead of discarding the publish.
    let deniedRenames = 0;
    const { course, dropboxDir, run } = await setupSync({
      wrapFileSystem: (real) =>
        FileSystem.make({
          ...real,
          // Effect.suspend so the deny-or-delegate decision is made on every
          // execution — Effect.retry re-runs the constructed effect, it does
          // not call this factory again.
          rename: (oldPath, newPath) =>
            Effect.suspend(() => {
              if (
                deniedRenames < 2 &&
                newPath.includes(`versions${path.sep}`)
              ) {
                deniedRenames++;
                return Effect.fail(
                  new SystemError({
                    reason: "PermissionDenied",
                    module: "FileSystem",
                    method: "rename",
                    pathOrDescriptor: oldPath,
                    description: "EACCES: permission denied (sync lock)",
                  })
                );
              }
              return real.rename(oldPath, newPath);
            }),
        }),
    });

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    expect(deniedRenames).toBe(2);
    const courseDir = path.join(dropboxDir, "test-course");
    const doc = readCourseManifest(courseDir);
    for (const video of getManifestVideos(doc)) {
      expect(
        fs.existsSync(path.join(courseDir, ...video.relativePath.split("/")))
      ).toBe(true);
    }
  }, 30_000);

  it("stages outside the synced tree when PUBLISH_STAGING_DIR is set", async () => {
    const stagingRoot = fs.mkdtempSync(
      path.join(tmpdir(), "sync-test-staging-")
    );
    const renameSources: string[] = [];
    const { course, dropboxDir, run } = await setupSync({
      publishStagingDir: stagingRoot,
      wrapFileSystem: (real) =>
        FileSystem.make({
          ...real,
          rename: (oldPath, newPath) => {
            renameSources.push(oldPath);
            return real.rename(oldPath, newPath);
          },
        }),
    });

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    // The bundle was staged under PUBLISH_STAGING_DIR, never inside the
    // synced tree, and the staging area is cleaned up afterwards.
    const bundleRenameSource = renameSources.find((source) =>
      source.includes("cvm-staging-")
    );
    expect(bundleRenameSource).toBeDefined();
    expect(bundleRenameSource!.startsWith(stagingRoot)).toBe(true);
    expect(fs.readdirSync(stagingRoot)).toEqual([]);

    const courseDir = path.join(dropboxDir, "test-course");
    const doc = readCourseManifest(courseDir);
    for (const video of getManifestVideos(doc)) {
      expect(
        fs.existsSync(path.join(courseDir, ...video.relativePath.split("/")))
      ).toBe(true);
    }
  });

  it("rejects same-sized bundle corruption without moving the commit marker", async () => {
    const { course, dropboxDir, run } = await setupSync();
    const courseDir = path.join(dropboxDir, "test-course");

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );
    const manifestBefore = fs.readFileSync(
      path.join(courseDir, "course.json"),
      "utf-8"
    );
    const destination = path.join(
      courseDir,
      ...getManifestVideos(JSON.parse(manifestBefore))[0]!.relativePath.split(
        "/"
      )
    );
    fs.writeFileSync(
      destination,
      "x".repeat(Buffer.byteLength("video-content"))
    );

    await expect(
      run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          yield* svc.syncToDropbox(course.id, true);
        })
      )
    ).rejects.toBeDefined();

    expect(fs.readFileSync(path.join(courseDir, "course.json"), "utf-8")).toBe(
      manifestBefore
    );
    expect(
      fs
        .readdirSync(courseDir)
        .some((entry) => entry.startsWith(".cvm-staging-"))
    ).toBe(false);
  });

  it("copies videos for all lessons", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const courseDir = path.join(dropboxDir, "test-course");
    const videos = getManifestVideos(readCourseManifest(courseDir));
    expect(videos).toHaveLength(2);
    expect(
      videos.every((video) =>
        fs.existsSync(path.join(courseDir, ...video.relativePath.split("/")))
      )
    ).toBe(true);
  });

  it("writes only .mp4, course.json, and course.schema.json — no authoring sidecars", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const courseDir = path.join(dropboxDir, "test-course");
    const allFiles = getAllFilesRecursive(courseDir);
    const relFiles = allFiles.map((f) => path.relative(courseDir, f)).sort();
    const doc = readCourseManifest(courseDir);
    const expectedFiles = [
      "course.json",
      doc.$schema,
      `${path.posix.dirname(doc.$schema)}/manifest.json`,
      ...getManifestVideos(doc).map((video) => video.relativePath),
    ].sort();

    expect(relFiles).toEqual(expectedFiles);
  });

  it("does not write .transcript.md, .body.md, .meta.json, TODO.md, or changelog.md", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await testDb
      .update(videosTable)
      .set({ body: "# Lesson Body\n\nSome content here." })
      .where(eq(videosTable.title, "Problem"));

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const courseDir = path.join(dropboxDir, "test-course");
    const allFiles = getAllFilesRecursive(courseDir);
    const extensions = allFiles.map((f) => path.basename(f));

    expect(extensions).not.toContain("Problem.transcript.md");
    expect(extensions).not.toContain("Problem.body.md");
    expect(extensions).not.toContain("Problem.meta.json");
    expect(extensions).not.toContain("TODO.md");
    expect(extensions).not.toContain("changelog.md");
  });

  it("does not sweep legacy root artifacts during the atomic v3 commit", async () => {
    const { course, dropboxDir, run } = await setupSync();

    const staleDir = path.join(
      dropboxDir,
      "test-course",
      "01-intro",
      "01.01-welcome"
    );
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, "old-file.ts"), "stale content");
    fs.writeFileSync(
      path.join(staleDir, "Problem.transcript.md"),
      "old transcript"
    );
    fs.writeFileSync(path.join(staleDir, "Problem.body.md"), "old body");
    fs.writeFileSync(
      path.join(staleDir, "Problem.meta.json"),
      '{"chapters": []}'
    );
    fs.writeFileSync(path.join(staleDir, "TODO.md"), "old todo");
    fs.writeFileSync(
      path.join(dropboxDir, "test-course", "changelog.md"),
      "old changelog"
    );

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    expect(fs.existsSync(path.join(staleDir, "old-file.ts"))).toBe(true);
    expect(fs.existsSync(path.join(staleDir, "Problem.transcript.md"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(staleDir, "Problem.body.md"))).toBe(true);
    expect(fs.existsSync(path.join(staleDir, "Problem.meta.json"))).toBe(true);
    expect(fs.existsSync(path.join(staleDir, "TODO.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(dropboxDir, "test-course", "changelog.md"))
    ).toBe(true);
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
    const { course, dropboxDir, run } = await setupSync();

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
      fs.existsSync(path.join(dropboxDir, "test-course", "course.json"))
    ).toBe(false);
  });

  it("emits course.json at the course root", async () => {
    const { course, version, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const courseJsonPath = path.join(dropboxDir, "test-course", "course.json");
    expect(fs.existsSync(courseJsonPath)).toBe(true);

    const doc = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    expect(doc.schemaVersion).toBe(3);
    expect(doc.courseId).toBe(course.id);
    expect(doc.courseVersionId).toBe(version.id);
    expect(doc.archiveTTL).toBe("90d");
    expect(doc.courseName).toBe("test-course");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].lessons).toHaveLength(2);
  });

  it("course.json contains no path field", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = JSON.parse(
      fs.readFileSync(
        path.join(dropboxDir, "test-course", "course.json"),
        "utf-8"
      )
    );
    expect(doc.sections[0]).not.toHaveProperty("path");
    const lesson = doc.sections[0].lessons[0];
    expect(lesson).not.toHaveProperty("path");
    const video = lesson.problem ?? lesson.explainer;
    expect(video).not.toHaveProperty("path");
  });

  it("course.json uses lineageId as correlation id", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = JSON.parse(
      fs.readFileSync(
        path.join(dropboxDir, "test-course", "course.json"),
        "utf-8"
      )
    );
    const lesson = doc.sections[0].lessons[0];
    expect(lesson.id).toBeDefined();
    expect(lesson.id).not.toBe("");
    expect(lesson.explainer?.id ?? lesson.problem?.id).toBeDefined();
  });

  it("course.json includes the render-input hash and exported byte receipt", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const doc = JSON.parse(
      fs.readFileSync(
        path.join(dropboxDir, "test-course", "course.json"),
        "utf-8"
      )
    );
    const lesson = doc.sections[0].lessons[0];
    const video = lesson.problem ?? lesson.explainer;
    expect(video.hash).not.toBeNull();
    expect(typeof video.hash).toBe("string");
    expect(video.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(video.bytes).toBe(Buffer.byteLength("video-content"));
  });

  it("does not resolve or publish archived videos", async () => {
    const { course, video2, dropboxDir, run } = await setupSync();
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
    const videos = getManifestVideos(
      readCourseManifest(path.join(dropboxDir, "test-course"))
    );
    expect(videos).toHaveLength(1);
    expect(videos[0]!.relativePath).not.toContain("01.02-setup");
  });

  // ── Withholding to-do lessons (includeTodoLessons = false) ──────────

  it("withholds a to-do lesson's folder and omits it from course.json", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, false);
      })
    );

    const courseDir = path.join(dropboxDir, "test-course");
    const doc = readCourseManifest(courseDir);
    const videos = getManifestVideos(doc);
    expect(videos).toHaveLength(1);
    expect(videos[0]!.relativePath).toContain("01.01-welcome/Problem.mp4");
    expect(
      fs.existsSync(path.join(courseDir, ...videos[0]!.relativePath.split("/")))
    ).toBe(true);
    expect(videos[0]!.relativePath).not.toContain("01.02-setup");

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].lessons).toHaveLength(1);
  });

  it("keeps the prior immutable bundle when a later manifest withholds a to-do lesson", async () => {
    const { course, dropboxDir, run } = await setupSync();

    // First publish includes the to-do lesson…
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );
    const courseDir = path.join(dropboxDir, "test-course");
    const firstDoc = readCourseManifest(courseDir);
    const previousTodoVideo = getManifestVideos(firstDoc).find((video) =>
      video.relativePath.includes("01.02-setup")
    )!;
    const previousTodoPath = path.join(
      courseDir,
      ...previousTodoVideo.relativePath.split("/")
    );
    expect(fs.existsSync(previousTodoPath)).toBe(true);

    // …a later publish withholds it from the new commit marker while retaining
    // the prior immutable bundle for rollback.
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, false);
      })
    );
    const secondDoc = readCourseManifest(courseDir);
    expect(
      getManifestVideos(secondDoc).some((video) =>
        video.relativePath.includes("01.02-setup")
      )
    ).toBe(false);
    expect(fs.existsSync(previousTodoPath)).toBe(true);
  });
});

function getAllFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function readCourseManifest(courseDir: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(courseDir, "course.json"), "utf-8")
  );
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
