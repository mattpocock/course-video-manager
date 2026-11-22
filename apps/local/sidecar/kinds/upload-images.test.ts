import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Fiber, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { CloudinaryMarkdownService } from "@/services/cloudinary-markdown-service";
import { CloudinaryService } from "@/services/cloudinary-service";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import {
  IMAGE_UPLOADED_EVENT,
  imageUploadsOf,
  swapImageUploads,
} from "@/features/image-upload/image-upload-job";
import type { JobContext } from "../job-kind";
import { JOB_KIND_SPECS, enqueueJob } from "../job-specs";
import { removeLocalImagesJobKind, uploadImagesJobKind } from "./upload-images";
import { delay } from "@/packages/clock";

let testDb: TestDb;
let dbLayer: Layer.Layer<VideoOperationsService | JobOperationsService>;
let videoId: string;
let folder: string;
let filesDir: string;
let storageRoot: string;
const previousFilesDir = process.env.VIDEO_FILES_DIR;
const previousRoots = process.env.STORAGE_ROOTS;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  dbLayer = Layer.mergeAll(
    VideoOperationsService.Default,
    JobOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)));
  // Video Files are in video-files/ on a temp Storage Root; the legacy
  // store (VIDEO_FILES_DIR) is a folder of its own that stays empty.
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "upload-images-"));
  filesDir = path.join(storageRoot, "video-files");
  process.env.STORAGE_ROOTS = storageRoot;
  process.env.VIDEO_FILES_DIR = path.join(storageRoot, "legacy");
});

afterAll(() => {
  if (previousFilesDir === undefined) delete process.env.VIDEO_FILES_DIR;
  else process.env.VIDEO_FILES_DIR = previousFilesDir;
  if (previousRoots === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = previousRoots;
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  const seeded = await seedCourseVersion(testDb, [
    { path: "01-intro", videos: [{}] },
  ]);
  videoId = Object.values(seeded.videoIds)[0]!;
  const video = await testDb.query.videos.findFirst({
    where: (t, { eq }) => eq(t.id, videoId),
  });
  folder = path.join(filesDir, video!.lineageId);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  completed.length = 0;
  started.length = 0;
  hang = new Set();
});

/**
 * Cloudinary, faked: what started and what finished, and a file whose upload
 * never answers (the sidecar is stopped mid-batch).
 */
const started: string[] = [];
const completed: string[] = [];
let hang = new Set<string>();
const fakeCloudinary = Layer.succeed(CloudinaryService, {
  upload: (filePath: string) =>
    Effect.suspend(() => {
      const name = path.basename(filePath);
      started.push(name);
      if (hang.has(name)) return Effect.never;
      completed.push(name);
      return Effect.succeed(`https://res.cloudinary.com/test/${name}`);
    }),
} as unknown as CloudinaryService);

const layer = () =>
  Layer.mergeAll(
    dbLayer,
    CloudinaryMarkdownService.Default.pipe(Layer.provide(fakeCloudinary)),
    NodeContext.layer
  );

const writeImages = (...names: string[]) => {
  for (const name of names) fs.writeFileSync(path.join(folder, name), name);
};
const onDisk = (name: string) => fs.existsSync(path.join(folder, name));

const enqueue = (kind: string, params: Record<string, unknown>) =>
  Effect.runPromise(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.enqueueJob({
        id: null,
        kind,
        title: kind,
        lane: "default",
        params,
        maxAttempts: 1,
        dependsOn: null,
        subject: { type: "video", id: videoId },
      })
    ).pipe(Effect.provide(dbLayer))
  );

const eventsOf = (jobId: string) =>
  Effect.runPromise(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.listJobEvents(jobId)
    ).pipe(Effect.provide(dbLayer))
  );

const ctxFor = (jobId: string, onEvent: (type: string) => void = () => {}) =>
  ({
    jobId,
    attempt: 1,
    maxAttempts: 1,
    enqueue: () => Effect.die("this kind starts no other Job"),
    emit: (type, data) =>
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.appendJobEvent({ jobId, type, data })
      ).pipe(
        Effect.orDie,
        Effect.provide(dbLayer),
        Effect.tap(() => Effect.sync(() => onEvent(type)))
      ),
  }) satisfies JobContext;

/** One run of the upload Job; `firstRecorded` resolves on its first record. */
const startUploadRun = (jobId: string, body: string) => {
  let resolve!: () => void;
  const firstRecorded = new Promise<void>((r) => (resolve = r));
  const fiber = Effect.runFork(
    uploadImagesJobKind
      .runRaw(
        { videoId, body },
        ctxFor(jobId, () => resolve())
      )
      .pipe(Effect.provide(layer()))
  );
  return { fiber, firstRecorded };
};

const BODY = [
  "Intro ![a](a.png)",
  "- ![a, twice](a.png)",
  "> ![b](b.png)",
  "![c](c.png)",
].join("\n");

describe("an upload-images Job interrupted mid-batch and run again", () => {
  it("uploads every image exactly once, duplicates no link and loses no file", async () => {
    writeImages("a.png", "b.png", "c.png", "unrelated.png");
    const job = await enqueue("upload-images", { videoId, body: BODY });

    // Run 1: a lands; b is mid-upload when the sidecar is stopped.
    hang = new Set(["b.png"]);
    const run1 = startUploadRun(job.id, BODY);
    await run1.firstRecorded;
    await delay(50);
    await Effect.runPromise(Fiber.interrupt(run1.fiber));
    expect(completed).toEqual(["a.png"]);
    // The upload Job never deletes: every file is still on disk.
    expect(["a.png", "b.png", "c.png"].every(onDisk)).toBe(true);

    // Run 2, the same Job put back: a is not uploaded again.
    hang = new Set();
    await Effect.runPromise(Fiber.join(startUploadRun(job.id, BODY).fiber));
    expect(completed.sort()).toEqual(["a.png", "b.png", "c.png"]);

    // A third run (recovered again) does nothing at all.
    const before = (await eventsOf(job.id)).length;
    await Effect.runPromise(Fiber.join(startUploadRun(job.id, BODY).fiber));
    expect(completed).toHaveLength(3);
    const events = await eventsOf(job.id);
    expect(events.filter((e) => e.type === IMAGE_UPLOADED_EVENT)).toHaveLength(
      3
    );
    // ...and writes no event.
    expect(events.length).toBe(before);

    // Each reference is recorded once.
    const uploads = imageUploadsOf(events);
    expect(uploads.map((u) => u.ref).sort()).toEqual([
      "a.png",
      "b.png",
      "c.png",
    ]);

    // The tab swaps into the body AS EDITED while the Job ran: the author
    // added a line and deleted c.
    const edited = [
      "Intro ![a](a.png)",
      "A line typed mid-upload.",
      "- ![a, twice](a.png)",
      "> ![b](b.png)",
    ].join("\n");
    const swapped = swapImageUploads(edited, uploads);
    expect(swapped.body).toBe(
      [
        "Intro ![a](https://res.cloudinary.com/test/a.png)",
        "A line typed mid-upload.",
        "- ![a, twice](https://res.cloudinary.com/test/a.png)",
        "> ![b](https://res.cloudinary.com/test/b.png)",
      ].join("\n")
    );
    // Swapping again changes nothing: no double swap.
    expect(swapImageUploads(swapped.body, uploads).body).toBe(swapped.body);

    // Only what went into the body is removed: c was deleted from the body,
    // so its file stays; a file no upload recorded is refused.
    const removal = await enqueue("remove-local-images", {
      videoId,
      filePaths: [
        ...swapped.swappedFilePaths,
        path.join(folder, "unrelated.png"),
      ],
    });
    await Effect.runPromise(
      removeLocalImagesJobKind
        .runRaw(
          {
            videoId,
            filePaths: [
              ...swapped.swappedFilePaths,
              path.join(folder, "unrelated.png"),
            ],
          },
          ctxFor(removal.id)
        )
        .pipe(Effect.provide(layer()))
    );
    expect(onDisk("a.png")).toBe(false);
    expect(onDisk("b.png")).toBe(false);
    expect(onDisk("c.png")).toBe(true);
    expect(onDisk("unrelated.png")).toBe(true);
  });

  it("gives a later Job the recorded URL of a file already removed", async () => {
    writeImages("a.png");
    const first = await enqueue("upload-images", {
      videoId,
      body: "![a](a.png)",
    });
    await Effect.runPromise(
      Fiber.join(startUploadRun(first.id, "![a](a.png)").fiber)
    );
    fs.rmSync(path.join(folder, "a.png"));

    // The tab closed before swapping; the saved body still names a.png.
    const second = await enqueue("upload-images", {
      videoId,
      body: "![a](a.png)",
    });
    await Effect.runPromise(
      Fiber.join(startUploadRun(second.id, "![a](a.png)").fiber)
    );
    expect(completed).toEqual(["a.png"]);
    expect(imageUploadsOf(await eventsOf(second.id))).toEqual([
      {
        ref: "a.png",
        filePath: path.join(folder, "a.png"),
        url: "https://res.cloudinary.com/test/a.png",
      },
    ]);
  });

  it("Upload pressed again after the tab closed: waits for the live Job, then reuses every URL", async () => {
    writeImages("a.png", "b.png");
    const body = "![a](a.png)\n![b](b.png)";
    // What the tab's Upload sends (`POST /api/jobs`): a fresh id each press.
    const press = () =>
      Effect.runPromise(
        enqueueJob({
          id: crypto.randomUUID(),
          kind: "upload-images",
          title: "Upload images to Cloudinary",
          params: { videoId, body },
          dependsOn: null,
          subject: { type: "video", id: videoId },
          attemptsSpent: 0,
          registry: JOB_KIND_SPECS,
        }).pipe(Effect.provide(dbLayer))
      );
    const first = await press();
    const second = await press();
    // Not a second Job running beside the first: it waits for it.
    expect(second.dependsOn).toBe(first.id);

    await Effect.runPromise(Fiber.join(startUploadRun(first.id, body).fiber));
    await Effect.runPromise(Fiber.join(startUploadRun(second.id, body).fiber));

    // Both files are still on disk (nothing swapped), yet each went up once.
    expect(completed).toEqual(["a.png", "b.png"]);
    expect(imageUploadsOf(await eventsOf(second.id))).toEqual(
      imageUploadsOf(await eventsOf(first.id))
    );
  });
});
