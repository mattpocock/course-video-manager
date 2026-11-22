import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Exit, Layer } from "effect";
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
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import { clipMockups } from "@/db/schema";
import {
  COURSE_FILES_COPIED_EVENT,
  COURSE_ROWS_COPIED_EVENT,
  courseRowsCopiedOf,
} from "@/features/jobs/duplicate-course-job";
import {
  copyPlannedFile,
  verifyPlannedFiles,
} from "@/services/course-duplicate-files";
import type { JobContext } from "../job-kind";
import { duplicateCourseJobKind } from "./duplicate-course";
import { readEnv } from "@/packages/env";

let testDb: TestDb;
let dbLayer: Layer.Layer<
  CourseOperationsService | ClipMockupOperationsService | JobOperationsService
>;
let frames: { dir: string };
let filesDir: string;
let legacyDir: string;
const previousFilesDir = readEnv("VIDEO_FILES_DIR");
const previousRoots = readEnv("STORAGE_ROOTS");
let storageRoot: string;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    ClipMockupOperationsService.Default,
    JobOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)));
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-mockups-"));
  frames = { dir: path.join(storageRoot, "clip-mockups") };
  fs.mkdirSync(frames.dir);
  process.env.STORAGE_ROOTS = storageRoot;
  // Video Files are in video-files/ on the Storage Root; the legacy store
  // (VIDEO_FILES_DIR) is an empty folder of its own.
  filesDir = path.join(storageRoot, "video-files");
  fs.mkdirSync(filesDir);
  legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-course-"));
  process.env.VIDEO_FILES_DIR = legacyDir;
});

afterAll(() => {
  if (previousRoots === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = previousRoots;
  fs.rmSync(storageRoot, { recursive: true, force: true });
  if (previousFilesDir === undefined) delete process.env.VIDEO_FILES_DIR;
  else process.env.VIDEO_FILES_DIR = previousFilesDir;
  fs.rmSync(legacyDir, { recursive: true, force: true });
});

let sourceCourseId: string;
let sourceLineageId: string;

/** One Video with two live Clip Mockups, one archived, and two Video Files. */
beforeEach(async () => {
  await truncateAllTables(testDb);
  const seeded = await seedCourseVersion(testDb, [
    { path: "01-intro", videos: [{}] },
  ]);
  sourceCourseId = seeded.courseId;
  const videoId = Object.values(seeded.videoIds)[0]!;
  const video = await testDb.query.videos.findFirst({
    where: (t, { eq }) => eq(t.id, videoId),
  });
  sourceLineageId = video!.lineageId;
  const mockups = path.join(frames.dir, sourceLineageId);
  fs.mkdirSync(mockups, { recursive: true });
  for (const name of ["f1.png", "f2.png", "s1.wav", "archived.png"]) {
    fs.writeFileSync(path.join(mockups, name), `bytes of ${name}`);
  }
  const files = path.join(filesDir, sourceLineageId, "thumbnails");
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, "t.png"), "thumbnail");
  fs.writeFileSync(path.join(filesDir, sourceLineageId, "notes.md"), "notes");
  await testDb.insert(clipMockups).values([
    {
      videoId,
      line: "One",
      imagePath: "f1.png",
      audioPath: "s1.wav",
      durationSeconds: 1,
      order: "a0",
    },
    {
      videoId,
      line: "Two",
      imagePath: "f2.png",
      audioPath: "s1.wav",
      durationSeconds: 1,
      order: "a1",
    },
    {
      videoId,
      line: "Gone",
      imagePath: "archived.png",
      audioPath: "s1.wav",
      durationSeconds: 1,
      order: "a2",
      archived: true,
    },
  ]);
});

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(Layer.mergeAll(dbLayer, NodeContext.layer))
    ) as Effect.Effect<A, E, never>
  );

const newJob = async () => {
  const exit = await run(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.enqueueJob({
        id: null,
        kind: "duplicate-course",
        title: "Duplicate",
        lane: "default",
        params: {},
        maxAttempts: 2,
        dependsOn: null,
        subject: null,
      })
    )
  );
  if (!Exit.isSuccess(exit)) throw new Error("could not enqueue");
  return exit.value.id;
};

const ctxFor = (jobId: string): JobContext => ({
  jobId,
  attempt: 1,
  maxAttempts: 2,
  enqueue: () => Effect.die("this kind starts no other Job"),
  emit: (type, data) =>
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.appendJobEvent({ jobId, type, data })
    ).pipe(Effect.orDie, Effect.provide(dbLayer)),
});

const newCourseId = "00000000-0000-4000-8000-000000000001";
const runJob = (jobId: string, courseId = newCourseId) =>
  run(
    duplicateCourseJobKind.runRaw(
      { sourceCourseId, name: "Copy", newCourseId: courseId },
      ctxFor(jobId)
    )
  );

const eventsOf = async (jobId: string) => {
  const exit = await run(
    Effect.flatMap(JobOperationsService, (ops) => ops.listJobEvents(jobId))
  );
  if (!Exit.isSuccess(exit)) throw new Error("could not read events");
  return exit.value;
};

const courseCount = async () => (await testDb.query.courses.findMany()).length;

/** Every file the copy should hold, relative to each store's Video folder. */
const copiedFiles = (lineageId: string) => ({
  mockups: fs.readdirSync(path.join(frames.dir, lineageId)).sort(),
  files: fs
    .readdirSync(path.join(filesDir, lineageId), { recursive: true })
    .map(String)
    .sort(),
});

describe("a duplicate-course Job", () => {
  it("copies the rows once and every live Video's files, checked", async () => {
    const jobId = await newJob();
    expect(Exit.isSuccess(await runJob(jobId))).toBe(true);

    const events = await eventsOf(jobId);
    const rows = courseRowsCopiedOf(events)!;
    expect(rows.courseId).toBe(newCourseId);
    const [video] = rows.videos;
    expect(copiedFiles(video!.newLineageId)).toEqual({
      mockups: ["f1.png", "f2.png", "s1.wav"],
      files: ["notes.md", "thumbnails", "thumbnails/t.png"],
    });
    expect(
      events.find((e) => e.type === COURSE_FILES_COPIED_EVENT)?.data
    ).toEqual({ files: 5, copied: 5, skipped: 0 });
    const copy = await testDb.query.courses.findFirst({
      where: (t, { eq }) => eq(t.id, newCourseId),
    });
    expect(copy?.archived).toBe(false);
  });

  it("resumed after a lost run, skips the rows and the files already in place", async () => {
    const jobId = await newJob();
    await runJob(jobId);
    const rows = courseRowsCopiedOf(await eventsOf(jobId))!;
    const target = rows.videos[0]!.newLineageId;
    // The lost run had copied f1 whole, cut f2 short, and not reached the rest.
    fs.writeFileSync(path.join(frames.dir, target, "f2.png"), "bytes");
    fs.rmSync(path.join(frames.dir, target, "s1.wav"));
    fs.rmSync(path.join(filesDir, target), { recursive: true });

    expect(Exit.isSuccess(await runJob(jobId))).toBe(true);

    expect(await courseCount()).toBe(2);
    const events = await eventsOf(jobId);
    expect(
      events.filter((e) => e.type === COURSE_ROWS_COPIED_EVENT)
    ).toHaveLength(1);
    expect(
      events.filter((e) => e.type === COURSE_FILES_COPIED_EVENT).at(-1)?.data
    ).toEqual({
      files: 5,
      copied: 4,
      skipped: 1,
    });
    expect(
      fs.readFileSync(path.join(frames.dir, target, "f2.png"), "utf8")
    ).toBe("bytes of f2.png");
    expect(copiedFiles(target).files).toEqual([
      "notes.md",
      "thumbnails",
      "thumbnails/t.png",
    ]);
  });

  it("fails loudly when its rows committed but were never recorded", async () => {
    const jobId = await newJob();
    await run(
      Effect.flatMap(CourseOperationsService, (ops) =>
        ops.duplicateCourse({ sourceCourseId, name: "Copy", newCourseId })
      )
    );

    const exit = await runJob(jobId);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("DuplicateRowsUnrecordedError");
    expect(await courseCount()).toBe(2);
  });

  it("names every file that is not in place, rather than finishing short", async () => {
    const from = path.join(filesDir, "from.png");
    fs.writeFileSync(from, "12345");
    const short = path.join(filesDir, "short.png");
    fs.writeFileSync(short, "12");
    const planned = [
      {
        store: filesDir,
        from,
        to: path.join(filesDir, "never-copied.png"),
        size: 5,
      },
      { store: filesDir, from, to: short, size: 5 },
      { store: filesDir, from, to: from, size: 5 },
    ];

    const exit = await run(verifyPlannedFiles(planned));

    expect(String(exit)).toContain("DuplicateFilesMissingError");
    expect(String(exit)).toContain("2 of 3 files did not reach the copy");
    expect(String(exit)).toContain("never-copied.png");
    expect(String(exit)).toContain("short.png");
  });

  it("two Jobs copying under one name at once make one Course", async () => {
    const [a, b] = [await newJob(), await newJob()];

    await Promise.all([
      runJob(a),
      runJob(b, "00000000-0000-4000-8000-000000000002"),
    ]);

    const copies = await testDb.query.courses.findMany({
      where: (t, { eq }) => eq(t.name, "Copy"),
    });
    expect(copies).toHaveLength(1);
  });

  it("keeps the Course archived while its files fail to copy", async () => {
    const unreadable = path.join(filesDir, sourceLineageId, "notes.md");
    fs.chmodSync(unreadable, 0o000);
    try {
      const exit = await runJob(await newJob());

      expect(Exit.isFailure(exit)).toBe(true);
      const copy = await testDb.query.courses.findFirst({
        where: (t, { eq }) => eq(t.id, newCourseId),
      });
      expect(copy?.archived).toBe(true);
    } finally {
      fs.chmodSync(unreadable, 0o644);
    }
  });

  it("refuses a copy through a symlink out of the store before making any folder", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    fs.symlinkSync(outside, path.join(filesDir, "escape"));
    const from = path.join(filesDir, "from.png");
    fs.writeFileSync(from, "12345");
    try {
      const exit = await run(
        copyPlannedFile({
          store: filesDir,
          from,
          to: path.join(filesDir, "escape", "made", "x.png"),
          size: 5,
        })
      );

      expect(String(exit)).toContain("PathOutsideBaseDirError");
      expect(fs.existsSync(path.join(outside, "made"))).toBe(false);
    } finally {
      fs.rmSync(path.join(filesDir, "escape"));
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
