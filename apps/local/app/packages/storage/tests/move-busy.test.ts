import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cause, Effect, Exit, Option } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { courseBucketId } from "../buckets";
import type { StorageRoots } from "../index";
import { deleteOtherStorageBucket } from "../delete";
import { purgeExportedVideos } from "../purge";
import { planStorageMove, startStorageMove } from "../move";

/**
 * A move and the Storage page's deletes never overlap (#2109): a Purge or a
 * delete refuses while a `storage-move` Job is queued or running, and a move
 * is never started while a Purge or delete is part-way through (and the
 * other way round). Temp directories as Storage Roots only.
 */

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let roots: StorageRoots;
let bucketId: string;

const db = () => testDb as unknown as Database;

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-move-busy-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(path.join(d, "raw-footage"), { recursive: true });
  fs.mkdirSync(e);
  roots = [d, e];
  fs.writeFileSync(path.join(d, "raw-footage/take.mkv"), "take");
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
  await testDb.insert(schema.clips).values({
    videoId: video!.id,
    videoFilename: "raw-footage/take.mkv",
    sourceStartTime: 0,
    sourceEndTime: 1,
    order: "a0",
    text: "",
  });
  bucketId = courseBucketId(course!.id);
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a refusal");
  return Option.getOrThrow(Cause.failureOption(exit.cause)) as {
    _tag: string;
    reason?: string;
    message: string;
    refusals?: { reason: string }[];
  };
};

const purge = () =>
  Effect.runPromiseExit(
    purgeExportedVideos({ db: db(), roots, bucketId, dryRun: true })
  );
const deleteRenders = () =>
  Effect.runPromiseExit(
    deleteOtherStorageBucket({
      db: db(),
      roots,
      bucketId: "overlay-render-cache",
      scratchDir: path.join(base, "scratch"),
    })
  );

describe("a Storage move and the Storage page's deletes", () => {
  it("a Purge and a delete refuse while a move is queued or running", async () => {
    for (const status of ["queued", "running"] as const) {
      await testDb.delete(schema.jobs);
      await testDb.insert(schema.jobs).values({
        kind: "storage-move",
        title: "Move Crash Course Footage to E:",
        lane: "default",
        params: { bucketId, kind: "footage", target: e },
        status,
        maxAttempts: 2,
      });
      const purged = failureOf(await purge());
      expect(purged.reason).toBe("export-running");
      expect(purged.message).toMatch(/a move is queued or running \(Move/);
      const deleted = failureOf(await deleteRenders());
      expect(deleted.reason).toBe("export-running");
    }
  });

  it("a move, a Purge and a delete refuse while a delete Job is live; the Job does not refuse itself", async () => {
    const [job] = await testDb
      .insert(schema.jobs)
      .values({
        kind: "storage-delete",
        title: "Delete Overlay Render Cache",
        lane: "default",
        params: {},
        status: "running",
        maxAttempts: 1,
      })
      .returning();
    const plan = await Effect.runPromise(
      planStorageMove({ db: db(), roots, bucketId, kind: "footage", target: e })
    );
    expect(plan.refusals.map((r) => r.reason)).toContain("storage-busy");
    expect(failureOf(await purge()).message).toMatch(
      /a delete is queued or running/
    );
    expect(failureOf(await deleteRenders()).reason).toBe("export-running");
    const self = await Effect.runPromiseExit(
      deleteOtherStorageBucket({
        db: db(),
        roots,
        bucketId: "overlay-render-cache",
        scratchDir: path.join(base, "scratch"),
        selfJobId: job!.id,
      })
    );
    expect(Exit.isSuccess(self)).toBe(true);
  });

  it("while a move is being started, a Purge, a delete and a second move all refuse", async () => {
    const seen: Exit.Exit<unknown, unknown>[] = [];
    const started = await Effect.runPromiseExit(
      startStorageMove({
        db: db(),
        roots,
        bucketId,
        kind: "footage",
        target: e,
        enqueue: () =>
          Effect.promise(async () => {
            seen.push(await purge(), await deleteRenders());
            seen.push(
              await Effect.runPromiseExit(
                startStorageMove({
                  db: db(),
                  roots,
                  bucketId,
                  kind: "footage",
                  target: e,
                  enqueue: () => Effect.succeed("second"),
                })
              )
            );
            const plan = await Effect.runPromise(
              planStorageMove({
                db: db(),
                roots,
                bucketId,
                kind: "footage",
                target: e,
              })
            );
            expect(plan.refusals.map((r) => r.reason)).toEqual([
              "storage-busy",
            ]);
            return "first";
          }),
      })
    );
    expect(Exit.isSuccess(started) && started.value).toBe("first");
    const [purged, deleted, second] = seen.map(failureOf);
    expect(purged?.reason).toBe("storage-busy");
    expect(deleted?.reason).toBe("storage-busy");
    expect(second?.refusals?.map((r) => r.reason)).toEqual(["storage-busy"]);

    // Let go once it is queued: a Purge is no longer held off by the hold.
    expect(Exit.isSuccess(await purge())).toBe(true);
  });

  it("a move refused by its checks enqueues nothing and lets go of the hold", async () => {
    fs.rmSync(e, { recursive: true });
    let enqueued = 0;
    const exit = await Effect.runPromiseExit(
      startStorageMove({
        db: db(),
        roots,
        bucketId,
        kind: "footage",
        target: e,
        enqueue: () => Effect.sync(() => ++enqueued),
      })
    );
    expect(failureOf(exit).refusals?.map((r) => r.reason)).toEqual([
      "target-offline",
    ]);
    expect(enqueued).toBe(0);
    expect(Exit.isSuccess(await purge())).toBe(true);
  });
});
