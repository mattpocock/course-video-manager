/**
 * Shared test setup for the Dropbox publish upload tests.
 *
 * It builds a Course whose Videos are already exported to disk, points the
 * publish code at an in-memory Dropbox fake, and hands back the helpers that
 * read what landed there. The upload tests and the Bundle-reuse tests both
 * publish the same world, so they share this file rather than each building
 * their own.
 */

import { beforeAll, afterEach } from "vitest";
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
export let fakeDropbox: ReturnType<typeof createFakeDropbox>;

/** Register the lifecycle every file that uses this setup needs. */
export function setupDropboxUploadTests() {
  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  afterEach(() => {
    fakeDropbox?.cleanup();
  });
}

export const DROPBOX_REMOTE_PATH = "/Courses";

/** Every single-shot `files/upload` call — videos, schema, manifest, receipt. */
const isUploadRequest = (url: string) =>
  url.includes("/2/files/upload") && !url.includes("session");

/** Only the `.mp4` uploads inside a bundle. */
export const isVideoUploadRequest = (url: string, init: RequestInit) => {
  if (!isUploadRequest(url)) return false;
  const arg = (init.headers as Record<string, string> | undefined)?.[
    "Dropbox-API-Arg"
  ];
  return Boolean(arg && JSON.parse(arg).path.endsWith(".mp4"));
};

/**
 * A course with `videoCount` lessons, each holding one Video whose clips —
 * and therefore whose Export Hash and exported bytes — are unique, so every
 * Video is a distinct file in the bundle.
 */
export const setupUploads = async (opts?: {
  videoCount?: number;
  config?: Record<string, string>;
}) => {
  const videoCount = opts?.videoCount ?? 6;
  await truncateAllTables(testDb);

  fakeDropbox = createFakeDropbox();
  fakeDropbox.install();

  finishedVideosDir = fs.mkdtempSync(
    path.join(tmpdir(), "upload-test-videos-")
  );

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

  const runDb = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(dbLayer) as any)
    ) as Promise<A>;

  const course = await runDb(
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      return yield* courseOps.createCourse({ name: "test-course" });
    })
  );

  const version = await runDb(
    Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      return yield* versionOps.createCourseVersion({
        repoId: course.id,
        name: "",
      });
    })
  );

  const section = await runDb(
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      const sections = yield* lsOps.createSections({
        repoVersionId: version.id,
        sections: [{ sectionPathWithNumber: "01-intro", sectionNumber: 1 }],
      });
      return sections[0]!;
    })
  );

  const videos: Array<{ id: string; title: string; exportPath: string }> = [];

  for (let index = 0; index < videoCount; index++) {
    const number = index + 1;
    const lesson = await runDb(
      Effect.gen(function* () {
        const lsOps = yield* LessonSectionOperationsService;
        const lessons = yield* lsOps.createLessons(section.id, [
          {
            lessonPathWithNumber: `01.0${number}-lesson-${number}`,
            lessonNumber: number,
          },
        ]);
        yield* lsOps.updateLesson(lessons[0]!.id, { authoringStatus: "done" });
        return lessons[0]!;
      })
    );

    const video = await runDb(
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;
        return yield* videoOps.createVideo(lesson.id, {
          title: `Explainer${number}`,
          originalFootagePath: `/tmp/footage${number}.mp4`,
        });
      })
    );

    await testDb
      .update(videosTable)
      .set({ body: "Video body", description: "Video description" })
      .where(eq(videosTable.id, video.id));

    // Unique clip timings per Video → unique Export Hash → unique file.
    const clipData = [
      {
        videoFilename: "recording.mp4",
        sourceStartTime: 0,
        sourceEndTime: 10 + number,
        order: "a0",
        text: "Hello world",
        pauseType: "none" as const,
      },
    ];
    await testDb
      .insert(clipsTable)
      .values(clipData.map((clip) => ({ ...clip, videoId: video.id })));

    const clips: ExportClip[] = clipData.map((clip) => ({
      videoFilename: clip.videoFilename,
      sourceStartTime: clip.sourceStartTime,
      sourceEndTime: clip.sourceEndTime,
      pauseType: "none",
      zoomType: "none",
      overlays: [],
    }));
    const exportHash = computeExportHash(clips, "landscape")!;
    const exportPath = resolveExportPath(
      finishedVideosDir,
      course.id,
      exportHash
    );
    // Distinct byte counts, so byte-weighted progress is observable.
    fs.writeFileSync(exportPath, `video-content-${"x".repeat(number * 8)}`);

    videos.push({ id: video.id, title: video.title, exportPath });
  }

  // Cloning a fresh Draft leaves the seeded version Published, which is what
  // `syncToDropbox` re-commits.
  await runDb(
    Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      yield* versionOps.copyVersionStructure({
        sourceVersionId: version.id,
        repoId: course.id,
        newVersionName: "",
      });
    })
  );

  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ["FINISHED_VIDEOS_DIRECTORY", finishedVideosDir],
        ["DROPBOX_REMOTE_PATH", DROPBOX_REMOTE_PATH],
        ...Object.entries(opts?.config ?? {}),
      ])
    )
  );

  const mockVideoProcessing = Layer.succeed(
    VideoProcessingService,
    fromPartial({
      exportVideoClips: () =>
        Effect.die(new Error("no export expected in these tests")),
    })
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

  const sync = (
    onProgress?: (event: "progress", data: { percentage: number }) => void,
    includeTodoLessons = true
  ) =>
    run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncToDropbox(
          course.id,
          includeTodoLessons,
          onProgress
        );
      })
    );

  return { course, version, videos, run, sync };
};

export const remoteBundleVideoPaths = () =>
  Array.from(fakeDropbox.files.values())
    .map((stored) => stored.pathDisplay)
    .filter((remotePath) => remotePath.endsWith(".mp4"))
    .sort();

/** The `{versionFingerprint}-{assetFingerprint}` directory the bundle landed in. */
export const remoteBundleDirs = () =>
  Array.from(
    new Set(
      remoteBundleVideoPaths().map(
        (remotePath) => remotePath.split("/versions/")[1]!.split("/")[0]!
      )
    )
  );

export const receiptManifest = () =>
  JSON.parse(
    fakeDropbox
      .get(`${DROPBOX_REMOTE_PATH}/test-course/course.json`)!
      .content.toString("utf-8")
  );

export const manifestVideos = (manifest: any): any[] =>
  manifest.sections.flatMap((section: any) =>
    section.lessons.flatMap((lesson: any) =>
      [lesson.explainer, lesson.problem, lesson.solution].filter(Boolean)
    )
  );

/** Take the current Draft to a frozen Version, so it can be committed. */
export const freezeLatestVersion = (
  course: { id: string },
  run: <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>
) =>
  run(
    Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      const latest = yield* versionOps.getLatestCourseVersion(course.id);
      yield* versionOps.freezeAndCloneVersion({
        sourceVersionId: latest!.id,
        repoId: course.id,
        newVersionName: "",
        sourceName: "second release",
        sourceDescription: "",
      });
      return latest!.id;
    })
  );

export const videoUploadCount = () =>
  fakeDropbox.fetchCalls.filter((call) =>
    isVideoUploadRequest(call.url, call.init)
  ).length;

export const copyBatchCount = () =>
  fakeDropbox.fetchCalls.filter((call) =>
    call.url.includes("/2/files/copy_batch_v2")
  ).length;
