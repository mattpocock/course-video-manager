import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { NodeContext } from "@effect/platform-node";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import * as schema from "@/db/schema";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { findExportedVideo } from "@/services/finished-videos.server";
import type { StorageRoots } from "@/packages/storage";
import { courseBucketId } from "@/packages/storage/buckets";
import { MOVE_PARTIAL_SUFFIX } from "@/packages/storage/move";
import { STORAGE_MOVED_EVENT } from "@/packages/storage/client";
import type { JobContext } from "../job-kind";
import { storageMoveJobKind } from "./storage-move";
import { readEnv } from "@/packages/env";
import { toDate } from "@/packages/clock";

/**
 * The `storage-move` Sidecar Job (#2109), run as the Sidecar runs it, against
 * PGlite and two temp directories as Storage Roots (never a real drive).
 */

let testDb: TestDb;
let dbLayer: Layer.Layer<JobOperationsService | DrizzleService>;
let base: string;
let d: string;
let e: string;
const previousRoots = readEnv("STORAGE_ROOTS");

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  dbLayer = JobOperationsService.Default.pipe(
    Layer.provideMerge(Layer.succeed(DrizzleService, testDb as never))
  );
});

afterAll(() => {
  if (previousRoots === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = previousRoots;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-move-job-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  process.env.STORAGE_ROOTS = `${d},${e}`;
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const roots = (): StorageRoots => [d, e];

const put = (dir: string, relative: string, content: Buffer | string) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

const bytes = (n: number, seed: number) =>
  Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + seed) % 253));

const sha = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const files = (dir: string) =>
  fs.existsSync(dir)
    ? (fs.readdirSync(dir, { recursive: true }) as string[])
        .filter((p) => fs.lstatSync(path.join(dir, p)).isFile())
        .map((p) => p.split(path.sep).join("/"))
        .sort()
    : [];

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(Layer.mergeAll(dbLayer, NodeContext.layer))
    ) as Effect.Effect<A, E, never>
  );

const newJob = async (params: Record<string, unknown>) => {
  const exit = await run(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.enqueueJob({
        id: null,
        kind: "storage-move",
        title: "Move",
        lane: "default",
        params,
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

const eventsOf = async (jobId: string) => {
  const exit = await run(
    Effect.flatMap(JobOperationsService, (ops) => ops.listJobEvents(jobId))
  );
  if (!Exit.isSuccess(exit)) throw new Error("could not read events");
  return exit.value;
};

const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected the Job to fail");
  return Option.getOrThrow(Cause.failureOption(exit.cause)) as {
    _tag: string;
    message: string;
  };
};

let bucketId: string;
let videoId: string;
let exportName: string;

const exportNameOf = async () => {
  const video = (
    await listVideosForExportHash(testDb as unknown as Database)
  ).find((v) => v.id === videoId)!;
  return `${video.courseId}-${computeExportHash(toExportClips(video.clips), video.format, roots())}.mp4`;
};

/** A Course whose one Video uses a take and a Recording Session. */
beforeEach(async () => {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Crash Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1 })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "v", originalFootagePath: "", lessonId: lesson!.id })
    .returning();
  videoId = video!.id;
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId,
      cameraFilePath: "raw-footage/s1/camera.mkv",
      screenFilePath: "raw-footage/s1/screen.mkv",
      micFilePath: "raw-footage/s1/mic.wav",
      status: "stopped",
    })
    .returning();
  await testDb.insert(schema.clips).values([
    {
      videoId,
      videoFilename: path.join(d, "raw-footage/take.mkv"),
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a0",
      text: "",
    },
    {
      videoId,
      videoFilename: "raw-footage/s1/camera.mkv",
      recordingSessionId: session!.id,
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a1",
      text: "",
    },
  ]);
  put(d, "raw-footage/take.mkv", bytes(9000, 1));
  put(d, "raw-footage/take.mkv.transcript.json", "{}");
  put(d, "raw-footage/s1/camera.mkv", bytes(4000, 2));
  put(d, "raw-footage/s1/screen.mkv", bytes(3000, 3));
  put(d, "raw-footage/s1/mic.wav", bytes(1000, 4));
  bucketId = courseBucketId(course!.id);
  exportName = await exportNameOf();
  put(d, `finished-videos/${exportName}`, bytes(5000, 5));
});

const FOOTAGE = [
  "raw-footage/s1/camera.mkv",
  "raw-footage/s1/mic.wav",
  "raw-footage/s1/screen.mkv",
  "raw-footage/take.mkv",
  "raw-footage/take.mkv.transcript.json",
];

describe("a storage-move Job", () => {
  it("copies a bucket's Footage, Recording Session files together, and verifies each; originals and rows untouched", async () => {
    const before = files(d).map((f) => [f, sha(path.join(d, f))]);
    const clipsBefore = await testDb.select().from(schema.clips);
    const jobId = await newJob({ bucketId, kind: "footage", target: e });

    const exit = await run(
      storageMoveJobKind.runRaw(
        { bucketId, kind: "footage", target: e },
        ctxFor(jobId)
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(files(e)).toEqual(FOOTAGE);
    for (const f of FOOTAGE) {
      expect(sha(path.join(e, f))).toBe(sha(path.join(d, f)));
    }
    expect(files(d).map((f) => [f, sha(path.join(d, f))])).toEqual(before);
    expect(await testDb.select().from(schema.clips)).toEqual(clipsBefore);

    const events = await eventsOf(jobId);
    const moved = events.find((ev) => ev.type === STORAGE_MOVED_EVENT);
    expect(moved?.data).toMatchObject({
      copied: { files: 5 },
      left: [],
    });
    expect(events.some((ev) => ev.type === "progress")).toBe(true);
    // Each partial was recorded as this Job's before it was made (#2169).
    expect(
      events
        .filter((ev) => ev.type === "move-partial")
        .map((ev) => (ev.data as { path: string }).path)
        .sort()
    ).toEqual(
      FOOTAGE.map((f) => `${path.join(e, f)}${MOVE_PARTIAL_SUFFIX}`).sort()
    );
  });

  it("moves Exported Videos: the Export Hash is unchanged and the Video is still exported once the original goes", async () => {
    const jobId = await newJob({
      bucketId,
      kind: "exported-videos",
      target: e,
    });
    const exit = await run(
      storageMoveJobKind.runRaw(
        { bucketId, kind: "exported-videos", target: e },
        ctxFor(jobId)
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await exportNameOf()).toBe(exportName);
    // As "Delete originals" (#2110) would leave it: only E:'s copy.
    fs.rmSync(path.join(d, "finished-videos", exportName));
    const found = await run(findExportedVideo(roots(), exportName));
    expect(Exit.isSuccess(found) && Option.getOrNull(found.value)).toBe(
      path.join(e, "finished-videos", exportName)
    );
  });

  it("resumes after a lost run", async () => {
    put(
      e,
      `raw-footage/take.mkv${MOVE_PARTIAL_SUFFIX}`,
      fs.readFileSync(path.join(d, "raw-footage/take.mkv")).subarray(0, 4000)
    );
    put(
      e,
      "raw-footage/s1/camera.mkv",
      fs.readFileSync(path.join(d, "raw-footage/s1/camera.mkv"))
    );
    const jobId = await newJob({ bucketId, kind: "footage", target: e });
    const exit = await run(
      storageMoveJobKind.runRaw(
        { bucketId, kind: "footage", target: e },
        ctxFor(jobId)
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(files(e)).toEqual(FOOTAGE);
    expect(sha(path.join(e, "raw-footage/take.mkv"))).toBe(
      sha(path.join(d, "raw-footage/take.mkv"))
    );
    const moved = (await eventsOf(jobId)).find(
      (ev) => ev.type === STORAGE_MOVED_EVENT
    );
    expect(moved?.data).toMatchObject({ verified: { files: 1 } });
  });

  it("on resume, trusts a copy it placed while both sizes and mtimes match its proof, and checks any other in full (#2179)", async () => {
    const jobId = await newJob({ bucketId, kind: "footage", target: e });
    const runJob = () =>
      run(
        storageMoveJobKind.runRaw(
          { bucketId, kind: "footage", target: e },
          ctxFor(jobId)
        )
      );
    expect(Exit.isSuccess(await runJob())).toBe(true);
    // Each placed copy was recorded with its proof: the source's SHA-256.
    const proofs = (await eventsOf(jobId))
      .filter((ev) => ev.type === "move-placed")
      .map((ev) => ev.data as { path: string; sha256: string });
    expect(proofs.map((p) => p.path).sort()).toEqual(
      FOOTAGE.map((f) => path.join(e, f)).sort()
    );
    for (const p of proofs) {
      expect(p.sha256).toBe(sha(path.join(d, path.relative(e, p.path))));
    }

    // One copy can no longer be read (its mtime unchanged): the proof holds,
    // so it is not read again, and that is the saving. Another changed
    // behind the Job's back at the same size, its mtime moved: it is
    // hashed in full, and caught.
    const unreadable = path.join(e, "raw-footage/take.mkv");
    fs.chmodSync(unreadable, 0o000);
    const changed = path.join(e, "raw-footage/s1/camera.mkv");
    const { atime, mtime } = fs.statSync(changed);
    const bytes = fs.readFileSync(changed);
    bytes[0] = bytes[0]! ^ 1;
    fs.writeFileSync(changed, bytes);
    fs.utimesSync(changed, atime, toDate(mtime.getTime() + 5000));

    const exit = await runJob();
    expect(Exit.isFailure(exit)).toBe(true);
    const result = (await eventsOf(jobId))
      .filter((ev) => ev.type === STORAGE_MOVED_EVENT)
      .at(-1)?.data as {
      verified: { files: number };
      left: { path: string; message: string }[];
    };
    expect(result.verified.files).toBe(FOOTAGE.length - 1);
    expect(result.left).toEqual([
      {
        path: "raw-footage/s1/camera.mkv",
        message: expect.stringMatching(/different checksum.*never overwritten/),
      },
    ]);
    fs.chmodSync(unreadable, 0o644);
  });

  it("cancelled, removes partial copies, leaves originals, and ends cancelled", async () => {
    // A lost run of this Job left a partial, and recorded it (#2169).
    const own = put(e, `raw-footage/take.mkv${MOVE_PARTIAL_SUFFIX}`, "half");
    const jobId = await newJob({ bucketId, kind: "footage", target: e });
    await testDb
      .insert(schema.jobEvents)
      .values({ jobId, type: "move-partial", data: { path: own } });
    await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        Effect.zipRight(
          ops.claimNextJob({ lane: "default", holder: "h", leaseMs: 30_000 }),
          ops.requestJobCancel({ jobId, kinds: ["storage-move"] })
        )
      )
    );
    const before = files(d);
    const exit = await run(
      storageMoveJobKind.runRaw(
        { bucketId, kind: "footage", target: e },
        ctxFor(jobId)
      )
    );
    expect(failureOf(exit)._tag).toBe("JobCancelledError");
    expect(files(e)).toEqual([]);
    expect(files(d)).toEqual(before);
  });

  it("refuses before copying anything: an Offline target, a running export, an active recording", async () => {
    const attempt = async () => {
      const jobId = await newJob({ bucketId, kind: "footage", target: e });
      return run(
        storageMoveJobKind.runRaw(
          { bucketId, kind: "footage", target: e },
          ctxFor(jobId)
        )
      );
    };

    fs.renameSync(e, `${e}-unplugged`);
    expect(failureOf(await attempt()).message).toMatch(/Offline/);
    fs.renameSync(`${e}-unplugged`, e);

    await testDb.insert(schema.jobs).values({
      kind: "export",
      title: "Export: v",
      lane: "default",
      params: { videoId },
      status: "queued",
      maxAttempts: 3,
    });
    expect(failureOf(await attempt()).message).toMatch(
      /export is queued or running/
    );
    await testDb.delete(schema.jobs);

    await testDb.update(schema.recordingSessions).set({ status: "recording" });
    expect(failureOf(await attempt()).message).toMatch(
      /Recording Session is active/
    );

    expect(files(e)).toEqual([]);
  });

  it("fails, naming each file it left, when a different file is in the way", async () => {
    put(e, "raw-footage/take.mkv", "not the same take");
    const jobId = await newJob({ bucketId, kind: "footage", target: e });
    const exit = await run(
      storageMoveJobKind.runRaw(
        { bucketId, kind: "footage", target: e },
        ctxFor(jobId)
      )
    );
    const failure = failureOf(exit);
    expect(failure._tag).toBe("StorageMoveIncompleteError");
    expect(failure.message).toMatch(
      /raw-footage\/take.mkv: .*never overwritten/
    );
    expect(fs.readFileSync(path.join(e, "raw-footage/take.mkv"), "utf8")).toBe(
      "not the same take"
    );
  });
});
