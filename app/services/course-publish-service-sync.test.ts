import { describe, it, expect } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  computeExportHash,
  resolveExportPath,
  type ExportClip,
} from "@/services/export-hash";
import { clips as clipsTable } from "@/db/schema";
import { CourseRepoParserService } from "@/services/course-repo-parser";
import { fromPartial } from "@total-typescript/shoehorn";
import { setupEffectTest } from "@/test-utils/setup-effect-test";

const ctx = setupEffectTest({
  services: [
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
  ],
});

let finishedVideosDir: string;

const setupSync = async () => {
  finishedVideosDir = fs.mkdtempSync(path.join(tmpdir(), "sync-test-videos-"));
  const dropboxDir = fs.mkdtempSync(path.join(tmpdir(), "sync-test-dropbox-"));
  const courseRepoDir = fs.mkdtempSync(path.join(tmpdir(), "sync-test-repo-"));

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

  const course = await ctx.run(
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      return yield* courseOps.createCourse({
        filePath: courseRepoDir,
        name: "test-course",
      });
    })
  );

  const version = await ctx.run(
    Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      return yield* versionOps.createCourseVersion({
        repoId: course.id,
        name: "",
      });
    })
  );

  const section = await ctx.run(
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      const sections = yield* lsOps.createSections({
        repoVersionId: version.id,
        sections: [{ sectionPathWithNumber: "01-intro", sectionNumber: 1 }],
      });
      return sections[0]!;
    })
  );

  // lesson1: authoringStatus "done"
  const lesson1 = await ctx.run(
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      const lessons = yield* lsOps.createLessons(section.id, [
        { lessonPathWithNumber: "01.01-welcome", lessonNumber: 1 },
      ]);
      yield* lsOps.updateLesson(lessons[0]!.id, { authoringStatus: "done" });
      return lessons[0]!;
    })
  );

  // lesson2: authoringStatus "todo" (default)
  const lesson2 = await ctx.run(
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      const lessons = yield* lsOps.createLessons(section.id, [
        { lessonPathWithNumber: "01.02-setup", lessonNumber: 2 },
      ]);
      return lessons[0]!;
    })
  );

  const video1 = await ctx.run(
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      return yield* videoOps.createVideo(lesson1.id, {
        path: "Problem",
        originalFootagePath: "/tmp/footage1.mp4",
      });
    })
  );

  const video2 = await ctx.run(
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      return yield* videoOps.createVideo(lesson2.id, {
        path: "Solution",
        originalFootagePath: "/tmp/footage2.mp4",
      });
    })
  );

  const clipData = [
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a0",
      text: "Hello world",
      beatType: "none" as const,
    },
    {
      videoFilename: "recording.mp4",
      sourceStartTime: 15,
      sourceEndTime: 25,
      order: "a1",
      text: "Welcome to the course",
      beatType: "none" as const,
    },
  ];

  await ctx.db
    .insert(clipsTable)
    .values(clipData.map((c) => ({ ...c, videoId: video1.id })));
  await ctx.db
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

  // Create course repo structure on disk
  const lesson1Dir = path.join(courseRepoDir, "01-intro", "01.01-welcome");
  const lesson2Dir = path.join(courseRepoDir, "01-intro", "01.02-setup");
  fs.mkdirSync(lesson1Dir, { recursive: true });
  fs.mkdirSync(lesson2Dir, { recursive: true });
  fs.writeFileSync(
    path.join(lesson1Dir, "index.ts"),
    "export const hello = 'world';"
  );
  fs.writeFileSync(
    path.join(lesson2Dir, "setup.tsx"),
    "export default function Setup() {}"
  );

  const mockRepoParser = Layer.succeed(
    CourseRepoParserService,
    fromPartial({
      parseRepo: () =>
        Effect.succeed([
          {
            sectionPathWithNumber: "01-intro",
            sectionNumber: 1,
            lessons: [
              { lessonPathWithNumber: "01.01-welcome", lessonNumber: 1 },
              { lessonPathWithNumber: "01.02-setup", lessonNumber: 2 },
            ],
          },
        ]),
    })
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
    ctx.testLayer,
    mockVideoProcessing,
    mockRepoParser,
    NodeContext.layer
  ).pipe(Layer.provide(configLayer));

  const testLayer = Layer.merge(
    coreTestLayer,
    CoursePublishService.Default.pipe(Layer.provide(coreTestLayer))
  );

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(testLayer) as any)
    ) as Promise<A>;

  return { course, dropboxDir, run };
};

describe("CoursePublishService.syncToDropbox", () => {
  it("copies video files to dropbox", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id);
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

  it("writes transcript files", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id);
      })
    );

    const transcriptPath = path.join(
      dropboxDir,
      "test-course",
      "01-intro",
      "01.01-welcome",
      "Problem.transcript.md"
    );
    expect(fs.existsSync(transcriptPath)).toBe(true);
    expect(fs.readFileSync(transcriptPath, "utf-8")).toContain("Hello world");
  });

  it("writes TODO markers for todo-status lessons only", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id);
      })
    );

    const todoPath = path.join(
      dropboxDir,
      "test-course",
      "01-intro",
      "01.02-setup",
      "TODO.md"
    );
    expect(fs.existsSync(todoPath)).toBe(true);
    expect(fs.readFileSync(todoPath, "utf-8")).toContain("TODO");

    const noTodoPath = path.join(
      dropboxDir,
      "test-course",
      "01-intro",
      "01.01-welcome",
      "TODO.md"
    );
    expect(fs.existsSync(noTodoPath)).toBe(false);
  });

  it("copies source files from course repo", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id);
      })
    );

    const sourceFile = path.join(
      dropboxDir,
      "test-course",
      "01-intro",
      "01.01-welcome",
      "index.ts"
    );
    expect(fs.existsSync(sourceFile)).toBe(true);
    expect(fs.readFileSync(sourceFile, "utf-8")).toBe(
      "export const hello = 'world';"
    );
  });

  it("deletes stale files from dropbox", async () => {
    const { course, dropboxDir, run } = await setupSync();

    const staleDir = path.join(
      dropboxDir,
      "test-course",
      "01-intro",
      "01.01-welcome"
    );
    fs.mkdirSync(staleDir, { recursive: true });
    const stalePath = path.join(staleDir, "old-file.ts");
    fs.writeFileSync(stalePath, "stale content");

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id);
      })
    );

    expect(fs.existsSync(stalePath)).toBe(false);
  });

  it("generates changelog.md", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id);
      })
    );

    expect(
      fs.existsSync(path.join(dropboxDir, "test-course", "changelog.md"))
    ).toBe(true);
  });

  it("patches changelog with versionOverride", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, undefined, {
          name: "v1.0",
          description: "First release",
        });
      })
    );

    const content = fs.readFileSync(
      path.join(dropboxDir, "test-course", "changelog.md"),
      "utf-8"
    );
    expect(content).toContain("v1.0");
  });

  it("emits per-lesson progress events", async () => {
    const { course, run } = await setupSync();

    const events: Array<{ event: string; data: unknown }> = [];
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id, (event, data) => {
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
        return yield* svc.syncToDropbox(course.id);
      })
    );

    expect(result.missingVideos.length).toBeGreaterThan(0);
  });

  it("copies videos for all lessons with semaphore concurrency", async () => {
    const { course, dropboxDir, run } = await setupSync();

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.syncToDropbox(course.id);
      })
    );

    expect(
      fs.existsSync(
        path.join(
          dropboxDir,
          "test-course",
          "01-intro",
          "01.02-setup",
          "Solution.mp4"
        )
      )
    ).toBe(true);
  });
});
