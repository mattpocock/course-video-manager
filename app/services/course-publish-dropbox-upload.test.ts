import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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

afterEach(() => {
  fakeDropbox?.cleanup();
});

const DROPBOX_REMOTE_PATH = "/Courses";

/** Every single-shot `files/upload` call — videos, schema, manifest, receipt. */
const isUploadRequest = (url: string) =>
  url.includes("/2/files/upload") && !url.includes("session");

/** Only the `.mp4` uploads inside a bundle. */
const isVideoUploadRequest = (url: string, init: RequestInit) => {
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
const setupUploads = async (opts?: {
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

const remoteBundleVideoPaths = () =>
  Array.from(fakeDropbox.files.values())
    .map((stored) => stored.pathDisplay)
    .filter((remotePath) => remotePath.endsWith(".mp4"))
    .sort();

/** The `{versionFingerprint}-{assetFingerprint}` directory the bundle landed in. */
const remoteBundleDirs = () =>
  Array.from(
    new Set(
      remoteBundleVideoPaths().map(
        (remotePath) => remotePath.split("/versions/")[1]!.split("/")[0]!
      )
    )
  );

const receiptManifest = () =>
  JSON.parse(
    fakeDropbox
      .get(`${DROPBOX_REMOTE_PATH}/test-course/course.json`)!
      .content.toString("utf-8")
  );

const manifestVideos = (manifest: any): any[] =>
  manifest.sections.flatMap((section: any) =>
    section.lessons.flatMap((lesson: any) =>
      [lesson.explainer, lesson.problem, lesson.solution].filter(Boolean)
    )
  );

describe("Dropbox publish upload — bundle addressing", () => {
  it("addresses the bundle by Export Hash, not by the exported bytes", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const originalBundleDirs = remoteBundleDirs();
    expect(originalBundleDirs).toHaveLength(1);

    // Wipe the remote entirely and re-encode every Video to different bytes.
    // The recipe — Clips, source timings, Video Format, Export Version Key —
    // is untouched, so the destination must be untouched too.
    fakeDropbox.files.clear();
    for (const video of videos) {
      fs.writeFileSync(video.exportPath, `re-encoded-${"z".repeat(64)}`);
    }

    await sync();

    expect(remoteBundleDirs()).toEqual(originalBundleDirs);
  });

  it("keeps every Video's SHA256 and byte count in the shipped manifest", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 3 });

    await sync();

    const expected = new Map(
      videos.map((video) => {
        const bytes = fs.readFileSync(video.exportPath);
        return [
          `${video.title}.mp4`,
          {
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
          },
        ];
      })
    );

    const entries = manifestVideos(receiptManifest());
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      const key = entry.relativePath.split("/").pop()!;
      expect({ sha256: entry.sha256, bytes: entry.bytes }).toEqual(
        expected.get(key)
      );
    }
  });

  it("re-derives the manifest's SHA256 from the bytes that actually shipped", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 1 });

    await sync();
    fakeDropbox.files.clear();
    const reEncoded = Buffer.from(`re-encoded-${"z".repeat(64)}`);
    fs.writeFileSync(videos[0]!.exportPath, reEncoded);

    await sync();

    expect(manifestVideos(receiptManifest())[0]).toMatchObject({
      sha256: createHash("sha256").update(reEncoded).digest("hex"),
      bytes: reEncoded.length,
    });
  });

  it("lands a differing to-do lesson setting in a distinct bundle", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    await sync(undefined, true);
    const withTodo = remoteBundleDirs();

    fakeDropbox.files.clear();
    await sync(undefined, false);
    const withoutTodo = remoteBundleDirs();

    expect(withTodo).toHaveLength(1);
    expect(withoutTodo).toHaveLength(1);
    expect(withoutTodo).not.toEqual(withTodo);
  });
});

describe("Dropbox publish upload — concurrency", () => {
  it("uploads several Videos at once, up to the default limit of 4", async () => {
    const { sync } = await setupUploads({ videoCount: 6 });

    // Deterministic: the barrier only trips if four uploads are genuinely in
    // flight together. A serial implementation hangs rather than passing.
    fakeDropbox.holdUntilInFlight(4, isVideoUploadRequest);

    await sync();

    expect(fakeDropbox.peakConcurrentRequests(isVideoUploadRequest)).toBe(4);
    expect(remoteBundleVideoPaths()).toHaveLength(6);
  });

  it("never exceeds the configured concurrency limit", async () => {
    const { sync } = await setupUploads({
      videoCount: 6,
      config: { DROPBOX_UPLOAD_CONCURRENCY: "2" },
    });

    fakeDropbox.holdUntilInFlight(2, isVideoUploadRequest);

    await sync();

    expect(fakeDropbox.peakConcurrentRequests(isVideoUploadRequest)).toBe(2);
    expect(remoteBundleVideoPaths()).toHaveLength(6);
  });

  it("reports monotonic progress with several uploads in flight", async () => {
    const { sync } = await setupUploads({ videoCount: 6 });

    const percentages: number[] = [];
    await sync((_event, data) => percentages.push(data.percentage));

    expect(percentages.length).toBeGreaterThan(0);
    expect([...percentages].sort((a, b) => a - b)).toEqual(percentages);
    expect(percentages.at(-1)).toBe(100);
  });
});

describe("Dropbox publish upload — resumability", () => {
  it("uploads the missing Videos of an interrupted bundle instead of failing", async () => {
    const { sync } = await setupUploads({ videoCount: 3 });

    await sync();
    const allVideoPaths = remoteBundleVideoPaths();
    expect(allVideoPaths).toHaveLength(3);

    // Simulate a Publish that died partway: the bundle directory exists but
    // one Video never landed.
    const droppedPath = allVideoPaths[1]!;
    fakeDropbox.files.delete(droppedPath.toLowerCase());
    expect(remoteBundleVideoPaths()).toHaveLength(2);

    const callsBefore = fakeDropbox.fetchCalls.length;
    await sync();

    expect(remoteBundleVideoPaths()).toEqual(allVideoPaths);
    const reUploaded = fakeDropbox.fetchCalls
      .slice(callsBefore)
      .filter((call) => isVideoUploadRequest(call.url, call.init))
      .map(
        (call) =>
          JSON.parse(
            (call.init.headers as Record<string, string>)["Dropbox-API-Arg"]!
          ).path
      );
    expect(reUploaded).toEqual([droppedPath]);
  });

  it("restores a bundle's missing manifest without re-uploading its Videos", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const manifestPath = Array.from(fakeDropbox.files.values()).find((stored) =>
      stored.pathDisplay.endsWith("manifest.json")
    )!.pathDisplay;
    fakeDropbox.files.delete(manifestPath.toLowerCase());

    const callsBefore = fakeDropbox.fetchCalls.length;
    await sync();

    expect(fakeDropbox.get(manifestPath)).toBeDefined();
    const videoUploads = fakeDropbox.fetchCalls
      .slice(callsBefore)
      .filter((call) => isVideoUploadRequest(call.url, call.init));
    expect(videoUploads).toHaveLength(0);
  });

  it("uploads zero Videos when re-publishing an unchanged Course Version", async () => {
    const { sync } = await setupUploads({ videoCount: 3 });

    await sync();

    const callsBefore = fakeDropbox.fetchCalls.length;
    await sync();

    const videoUploads = fakeDropbox.fetchCalls
      .slice(callsBefore)
      .filter((call) => isVideoUploadRequest(call.url, call.init));
    expect(videoUploads).toHaveLength(0);
  });

  it("still fails when a Video in the bundle does not match its expected bytes", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const target = remoteBundleVideoPaths()[0]!;
    const stored = fakeDropbox.get(target)!;
    // Same size, different bytes — an immutability violation, not a partial
    // transfer.
    fakeDropbox.store(
      stored.pathDisplay,
      Buffer.from("y".repeat(stored.content.length))
    );

    await expect(sync()).rejects.toBeDefined();
  });
});

describe("Dropbox publish upload — transient failures", () => {
  it("backs off and retries a rate-limited upload rather than failing", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    fakeDropbox.failNextRequests({
      match: isVideoUploadRequest,
      times: 1,
      status: 429,
      retryAfterSeconds: 1,
    });

    await sync();

    expect(remoteBundleVideoPaths()).toHaveLength(2);
  }, 20_000);
});

// ── Reuse from the previously Published Bundle ──────────────────────────────
// A new Course Version means a new Bundle address, so nothing of the previous
// release is already at the new path. But the Videos themselves are unchanged:
// same Clips, so the same Export Hash, so the same bytes. Those come from the
// old Bundle by server-side copy rather than from this machine.

/** Take the current Draft to a frozen Version, so it can be committed. */
const freezeLatestVersion = (
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

const videoUploadCount = () =>
  fakeDropbox.fetchCalls.filter((call) =>
    isVideoUploadRequest(call.url, call.init)
  ).length;

const copyBatchCount = () =>
  fakeDropbox.fetchCalls.filter((call) =>
    call.url.includes("/2/files/copy_batch_v2")
  ).length;

describe("Dropbox publish upload — reuse from the previous Bundle", () => {
  it("copies an unchanged Video inside Dropbox rather than sending its bytes again", async () => {
    const { course, run, sync } = await setupUploads({ videoCount: 2 });

    // First release. Every Video is uploaded, and the Commit receipt names
    // the Bundle they landed in.
    await sync();
    const uploadsAfterFirstRelease = videoUploadCount();
    expect(uploadsAfterFirstRelease).toBe(2);
    expect(remoteBundleDirs()).toHaveLength(1);

    const secondVersionId = await freezeLatestVersion(course, run);
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true
        );
      })
    );

    // A second Bundle exists and holds both Videos — but not one further byte
    // left this machine to put them there.
    expect(remoteBundleDirs()).toHaveLength(2);
    expect(remoteBundleVideoPaths()).toHaveLength(4);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease);
    expect(copyBatchCount()).toBe(1);
  }, 30_000);

  it("takes the manifest's sha256 and bytes from the previous manifest, reading no file", async () => {
    const { course, run, sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const firstManifestVideos = manifestVideos(receiptManifest());

    const secondVersionId = await freezeLatestVersion(course, run);
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true
        );
      })
    );

    const secondManifestVideos = manifestVideos(receiptManifest());
    const digestOf = (videos: any[]) =>
      videos
        .map((video) => `${video.hash}:${video.sha256}:${video.bytes}`)
        .sort();

    // Same recipe, same bytes, same numbers — carried across releases rather
    // than re-derived from a local read.
    expect(digestOf(secondManifestVideos)).toEqual(
      digestOf(firstManifestVideos)
    );
  }, 30_000);

  it("uploads after all when the previous Bundle's file has gone", async () => {
    const { course, run, sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const uploadsAfterFirstRelease = videoUploadCount();

    // Course Builder has archived the Bundle past its 90-day TTL: the receipt
    // still promises the files, and they are no longer there.
    for (const key of Array.from(fakeDropbox.files.keys())) {
      if (key.endsWith(".mp4")) fakeDropbox.files.delete(key);
    }

    const secondVersionId = await freezeLatestVersion(course, run);
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true
        );
      })
    );

    // The Publish stands. It just paid for it.
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease + 2);
    expect(remoteBundleVideoPaths()).toHaveLength(2);
  }, 30_000);

  it("adopts a landed Video whose export has since been collected", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const landed = remoteBundleVideoPaths();
    expect(landed).toHaveLength(2);
    const uploadsAfterFirstRelease = videoUploadCount();

    // The export garbage collector has been through. Both Videos are still at
    // their Bundle address; the local files they were made from are not.
    for (const video of videos) {
      fs.rmSync(video.exportPath, { force: true });
      fs.rmSync(`${video.exportPath}.sha256`, { force: true });
    }

    // Re-syncing the same Version addresses the same Bundle, so nothing is
    // owed but the manifest's numbers — and the previous manifest has them.
    // Before the reuse plan could supply those, this read the local file to
    // recover them and discarded the whole Publish when it had gone.
    const outcome: any = await sync();

    expect(outcome.missingVideos ?? []).toEqual([]);
    expect(remoteBundleVideoPaths()).toEqual(landed);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease);
  }, 30_000);
});
