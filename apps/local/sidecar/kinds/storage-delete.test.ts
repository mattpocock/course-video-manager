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
import type { StorageRoots } from "@/packages/storage";
import { findStoragePathSync } from "@/packages/storage/server";
import { courseBucketId } from "@/packages/storage/buckets";
import { STORAGE_DELETED_EVENT } from "@/packages/storage/client";
import type { JobContext } from "../job-kind";
import { storageDeleteJobKind } from "./storage-delete";
import { readEnv } from "@/packages/env";

/**
 * The `storage-delete` Sidecar Job (#2110), "Delete originals", run as the
 * Sidecar runs it, against PGlite and two temp directories as Storage Roots
 * (never a real drive).
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
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-delete-job-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  process.env.STORAGE_ROOTS = `${d},${e}`;
});

afterEach(() => {
  for (const dir of [d, e]) {
    if (!fs.existsSync(dir)) continue;
    for (const p of fs.readdirSync(dir, { recursive: true }) as string[]) {
      const full = path.join(dir, p);
      if (fs.lstatSync(full).isDirectory()) fs.chmodSync(full, 0o755);
    }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

const roots = (): StorageRoots => [d, e];

const put = (dir: string, relative: string, content: Buffer | string) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

const bytes = (n: number, seed: number) =>
  Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + seed) % 253));

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
        kind: "storage-delete",
        title: "Delete originals",
        lane: "default",
        params,
        maxAttempts: 1,
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
  maxAttempts: 1,
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

const exportNameOf = async () => {
  const video = (
    await listVideosForExportHash(testDb as unknown as Database)
  ).find((v) => v.id === videoId)!;
  return `${video.courseId}-${computeExportHash(toExportClips(video.clips), video.format, roots())}.mp4`;
};

/** A Course whose Footage and export are on D: and, copied, on E:. */
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
  await testDb.insert(schema.clips).values({
    videoId,
    videoFilename: "raw-footage/sub/take.mkv",
    sourceStartTime: 0,
    sourceEndTime: 1,
    order: "a0",
    text: "",
  });
  bucketId = courseBucketId(course!.id);
  for (const root of [d, e]) {
    put(root, "raw-footage/sub/take.mkv", bytes(9000, 1));
    put(root, `finished-videos/${await exportNameOf()}`, bytes(5000, 5));
  }
});

const params = () => ({ operation: "originals" as const, bucketId, from: d });

describe("a storage-delete Job (Delete originals)", () => {
  it("deletes the verified originals on D:, reports them, and every file still resolves with the same Export Hash", async () => {
    const exportBefore = await exportNameOf();
    const jobId = await newJob(params());
    const exit = await run(
      storageDeleteJobKind.runRaw(params(), ctxFor(jobId))
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(files(d)).toEqual([]);
    expect(files(e)).toEqual([
      `finished-videos/${exportBefore}`,
      "raw-footage/sub/take.mkv",
    ]);
    expect(await exportNameOf()).toBe(exportBefore);
    expect(findStoragePathSync("raw-footage/sub/take.mkv", roots())).toBe(
      path.join(e, "raw-footage/sub/take.mkv")
    );

    const events = await eventsOf(jobId);
    expect(
      events.find((ev) => ev.type === STORAGE_DELETED_EVENT)?.data
    ).toMatchObject({
      operation: "originals",
      location: d,
      deleted: { files: 2, bytes: 14000 },
      left: [],
    });
    expect(events.some((ev) => ev.type === "progress")).toBe(true);
  });

  it("a file it can't delete fails the Job with 'N files still on D:, retry'; the rest still go", async () => {
    fs.chmodSync(path.join(d, "raw-footage/sub"), 0o555);
    const jobId = await newJob(params());
    const exit = await run(
      storageDeleteJobKind.runRaw(params(), ctxFor(jobId))
    );
    const failure = failureOf(exit);
    expect(failure._tag).toBe("StorageDeleteIncompleteError");
    expect(failure.message).toMatch(/^1 deleted .*; 1 file still on .*, retry/);
    expect(files(d)).toEqual(["raw-footage/sub/take.mkv"]);
    const deleted = (await eventsOf(jobId)).find(
      (ev) => ev.type === STORAGE_DELETED_EVENT
    );
    expect(deleted?.data).toMatchObject({ deleted: { files: 1 } });
  });

  it("cancelled before it starts, deletes nothing and ends cancelled", async () => {
    const jobId = await newJob(params());
    await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        Effect.zipRight(
          ops.claimNextJob({ lane: "default", holder: "h", leaseMs: 30_000 }),
          ops.requestJobCancel({ jobId, kinds: ["storage-delete"] })
        )
      )
    );
    const exit = await run(
      storageDeleteJobKind.runRaw(params(), ctxFor(jobId))
    );
    expect(failureOf(exit)._tag).toBe("JobCancelledError");
    expect(files(d).length).toBe(2);
  });

  it("refuses, deleting nothing, while an export is queued or a recording is active", async () => {
    await testDb.insert(schema.jobs).values({
      kind: "export",
      title: "Export: v",
      lane: "default",
      params: { videoId },
      status: "queued",
      maxAttempts: 3,
    });
    const jobId = await newJob(params());
    const exit = await run(
      storageDeleteJobKind.runRaw(params(), ctxFor(jobId))
    );
    expect(failureOf(exit).message).toMatch(/Export: v/);
    expect(files(d).length).toBe(2);
  });
});
