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

const setupSync = async () => {
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
  const exportHash = computeExportHash(clips)!;

  fs.writeFileSync(
    resolveExportPath(finishedVideosDir, course.id, exportHash),
    "video-content"
  );

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

  return { course, video1, video2, dropboxDir, run };
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

    expect(
      fs.existsSync(
        path.join(
          dropboxDir,
          "test-course",
          "01-intro",
          "01.01-welcome",
          "Problem.mp4"
        )
      )
    ).toBe(true);
  });

  it("copies videos for all lessons", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    expect(
      fs.existsSync(
        path.join(
          dropboxDir,
          "test-course",
          "01-intro",
          "01.02-setup",
          "Explainer.mp4"
        )
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

    expect(relFiles).toEqual([
      "01-intro/01.01-welcome/Problem.mp4",
      "01-intro/01.02-setup/Explainer.mp4",
      "course.json",
      "course.schema.json",
    ]);
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

  it("deletes stale files from dropbox including old sidecars", async () => {
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

    expect(fs.existsSync(path.join(staleDir, "old-file.ts"))).toBe(false);
    expect(fs.existsSync(path.join(staleDir, "Problem.transcript.md"))).toBe(
      false
    );
    expect(fs.existsSync(path.join(staleDir, "Problem.body.md"))).toBe(false);
    expect(fs.existsSync(path.join(staleDir, "Problem.meta.json"))).toBe(false);
    expect(fs.existsSync(path.join(staleDir, "TODO.md"))).toBe(false);
    expect(
      fs.existsSync(path.join(dropboxDir, "test-course", "changelog.md"))
    ).toBe(false);
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

  it("returns missingVideos for videos without exported files", async () => {
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
  });

  it("emits course.json at the course root", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );

    const courseJsonPath = path.join(dropboxDir, "test-course", "course.json");
    expect(fs.existsSync(courseJsonPath)).toBe(true);

    const doc = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    expect(doc.schemaVersion).toBe(2);
    expect(doc.courseId).toBe(course.id);
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

  it("course.json includes per-video hash", async () => {
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
    // The "done" lesson ships…
    expect(
      fs.existsSync(
        path.join(courseDir, "01-intro", "01.01-welcome", "Problem.mp4")
      )
    ).toBe(true);
    // …the "todo" lesson does not.
    expect(fs.existsSync(path.join(courseDir, "01-intro", "01.02-setup"))).toBe(
      false
    );

    const doc = JSON.parse(
      fs.readFileSync(path.join(courseDir, "course.json"), "utf-8")
    );
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].lessons).toHaveLength(1);
  });

  it("removes a previously-published to-do lesson when it is later withheld", async () => {
    const { course, dropboxDir, run } = await setupSync();

    // First publish includes the to-do lesson…
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, true);
      })
    );
    const todoDir = path.join(
      dropboxDir,
      "test-course",
      "01-intro",
      "01.02-setup"
    );
    expect(fs.existsSync(path.join(todoDir, "Explainer.mp4"))).toBe(true);

    // …a later publish withholds it, and the stale-file cleanup deletes it.
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, false);
      })
    );
    expect(fs.existsSync(todoDir)).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          dropboxDir,
          "test-course",
          "01-intro",
          "01.01-welcome",
          "Problem.mp4"
        )
      )
    ).toBe(true);
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
