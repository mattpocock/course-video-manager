import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { classifyStorageFile } from "../buckets";
import type { StorageRoots } from "../index";
import { loadStorageOwnership } from "../scan";
import {
  MOVE_PARTIAL_SUFFIX,
  partialRecorder,
  realStorageMoveDisk,
  runStorageMove,
  sweepEndedMovePartials,
  type StorageMoveDisk,
} from "../move";
import { delay } from "@/packages/clock";

/**
 * A storage move's partial copies (#2169): no `.cvm-move-partial` may outlive
 * the Job that made it, and only the partials a Job recorded are ever
 * deleted. Storage Roots are temp directories (`d`, `e`); Unused Footage is
 * moved, so no rows are needed but the Job's own.
 */

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let roots: StorageRoots;

const db = () => testDb as unknown as Database;

const put = (dir: string, relative: string, content: string | Buffer) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

const exists = (p: string) => fs.existsSync(p);
const partialOn = (dir: string, relative: string) =>
  path.join(dir, `${relative}${MOVE_PARTIAL_SUFFIX}`);

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-partials-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const move = (
  opts: {
    recorded?: string[];
    ownPartials?: string[];
    recordPartial?: (p: string) => Promise<void>;
    disk?: Partial<StorageMoveDisk>;
  } = {}
) =>
  runStorageMove({
    db: db(),
    roots,
    bucketId: "unused-footage",
    kind: "footage",
    target: e,
    cancelRequested: () => false,
    disk: { ...realStorageMoveDisk, ...opts.disk },
    ownPartials: opts.ownPartials ?? [],
    recordPartial:
      opts.recordPartial ??
      (async (p) => {
        opts.recorded?.push(p);
      }),
  });

const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  return Option.getOrThrow(Cause.failureOption(exit.cause)) as {
    _tag: string;
    message: string;
  };
};

/** A storage-move Job row, ended or not, with the partials it recorded. */
const seedJob = async (opts: {
  status: "queued" | "running" | "failed" | "interrupted" | "succeeded";
  partials: string[];
  target?: string;
}) => {
  const [job] = await testDb
    .insert(schema.jobs)
    .values({
      id: crypto.randomUUID(),
      kind: "storage-move",
      title: "Move Unused Footage to E:",
      lane: "default",
      params: {
        bucketId: "unused-footage",
        kind: "footage",
        target: opts.target ?? e,
      },
      status: opts.status,
      maxAttempts: 2,
    })
    .returning();
  for (const p of opts.partials) {
    await testDb
      .insert(schema.jobEvents)
      .values({ jobId: job!.id, type: "move-partial", data: { path: p } });
  }
  return job!.id;
};

const eventsOf = async (jobId: string) =>
  (await testDb.select().from(schema.jobEvents))
    .filter((ev) => ev.jobId === jobId)
    .map((ev) => ev.type);

const sweep = () =>
  Effect.runPromise(sweepEndedMovePartials({ db: db(), roots }));

describe("a storage move's partials, run by run", () => {
  it("records each partial before it is made", async () => {
    put(d, "raw-footage/a.mkv", "aaaa");
    const recorded: string[] = [];
    const created: boolean[] = [];
    const exit = await Effect.runPromiseExit(
      move({
        recordPartial: async (p) => {
          created.push(exists(p));
          recorded.push(p);
        },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(recorded).toEqual([partialOn(e, "raw-footage/a.mkv")]);
    expect(created).toEqual([false]);
    expect(exists(path.join(e, "raw-footage/a.mkv"))).toBe(true);
  });

  it("a partial it could not record is never made, and the move stops", async () => {
    put(d, "raw-footage/a.mkv", "aaaa");
    const exit = await Effect.runPromiseExit(
      move({
        recordPartial: async () => {
          throw new Error("getaddrinfo ENOTFOUND db");
        },
      })
    );
    expect(failureOf(exit).message).toMatch(/could not record the partial/);
    expect(exists(partialOn(e, "raw-footage/a.mkv"))).toBe(false);
  });

  it("a clean stop (interruption) keeps the partial for the next run to resume", async () => {
    put(d, "raw-footage/a.mkv", "aaaa");
    let release!: () => void;
    let writing!: () => void;
    const started = new Promise<void>((r) => (writing = r));
    const held = new Promise<void>((r) => (release = r));
    const fiber = Effect.runFork(
      move({
        disk: {
          write: async (file, buffer, length, position) => {
            writing();
            await held;
            await realStorageMoveDisk.write(file, buffer, length, position);
          },
        },
      })
    );
    await started;
    await Effect.runPromise(Fiber.interrupt(fiber));
    release();
    await delay(100);
    expect(exists(partialOn(e, "raw-footage/a.mkv"))).toBe(true);
    expect(exists(path.join(e, "raw-footage/a.mkv"))).toBe(false);
  });

  it("success removes its own partial for a file with nothing left to copy, never another's", async () => {
    put(d, "raw-footage/a.mkv", "aaaa");
    // An earlier run's partial for a file whose original is gone since.
    const stale = put(e, `raw-footage/gone.mkv${MOVE_PARTIAL_SUFFIX}`, "gg");
    // Not this Job's: no record of it.
    const foreign = put(e, `raw-footage/other.mkv${MOVE_PARTIAL_SUFFIX}`, "o");
    const exit = await Effect.runPromiseExit(move({ ownPartials: [stale] }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(exists(stale)).toBe(false);
    expect(exists(foreign)).toBe(true);
  });

  it("a refused run (nothing to move) removes its own partials", async () => {
    const own = put(e, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`, "aa");
    const exit = await Effect.runPromiseExit(move({ ownPartials: [own] }));
    expect(failureOf(exit)._tag).toBe("StorageMoveRefusedError");
    expect(exists(own)).toBe(false);
  });

  it("E: full removes the partial", async () => {
    put(d, "raw-footage/a.mkv", "aaaa");
    let calls = 0;
    const exit = await Effect.runPromiseExit(
      move({ disk: { freeBytes: async () => (calls++ === 0 ? 1e9 : 1) } })
    );
    expect(failureOf(exit).message).toMatch(/full/);
    expect(exists(partialOn(e, "raw-footage/a.mkv"))).toBe(false);
  });

  it("a SHA-256 mismatch removes the partial and leaves the file", async () => {
    put(d, "raw-footage/a.mkv", "aaaa");
    const exit = await Effect.runPromiseExit(
      move({
        disk: {
          write: (file, buffer, length, position) => {
            const bad = Buffer.from(buffer.subarray(0, length));
            bad[0] = bad[0]! ^ 1;
            return realStorageMoveDisk.write(file, bad, length, position);
          },
        },
      })
    );
    expect(Exit.isSuccess(exit) && exit.value.left[0]?.message).toMatch(
      /checksum mismatch/
    );
    expect(exists(partialOn(e, "raw-footage/a.mkv"))).toBe(false);
  });

  it("a source that changes during the copy removes the partial", async () => {
    const src = put(d, "raw-footage/a.mkv", "aaaa");
    const exit = await Effect.runPromiseExit(
      move({
        disk: {
          write: async (file, buffer, length, position) => {
            await realStorageMoveDisk.write(file, buffer, length, position);
            // Still being written: touched once the copy has read it.
            if (position === 0) fs.utimesSync(src, new Date(), new Date(0));
          },
        },
      })
    );
    expect(Exit.isSuccess(exit) && exit.value.left[0]?.message).toMatch(
      /changed while it was copied/
    );
    expect(exists(partialOn(e, "raw-footage/a.mkv"))).toBe(false);
  });
});

describe("partialRecorder", () => {
  it("waits out a short database blip, and gives up after its window", async () => {
    let calls = 0;
    const flaky = {
      insert: () => ({
        values: async () => {
          calls += 1;
          if (calls <= 2) throw new Error("getaddrinfo ENOTFOUND db");
        },
      }),
    } as unknown as Database;
    await partialRecorder(
      flaky,
      "job",
      5_000
    )("/e/raw-footage/a.mkv.cvm-move-partial");
    expect(calls).toBe(3);

    const down = {
      insert: () => ({
        values: async () => {
          throw new Error("getaddrinfo ENOTFOUND db");
        },
      }),
    } as unknown as Database;
    await expect(
      partialRecorder(down, "job", 300)("/e/raw-footage/a.mkv.cvm-move-partial")
    ).rejects.toThrow(/ENOTFOUND/);
  });
});

describe("the sweep of ended Jobs' partials", () => {
  it("after a crash, kill or lost lease ends the Job, removes the partials it recorded and no other", async () => {
    const own = put(e, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`, "aaaa");
    const foreign = put(e, `raw-footage/b.mkv${MOVE_PARTIAL_SUFFIX}`, "bb");
    const jobId = await seedJob({ status: "interrupted", partials: [own] });
    const swept = await sweep();
    expect(swept).toEqual([
      { jobId, removed: { files: 1, bytes: 4, kept: [] } },
    ]);
    expect(exists(own)).toBe(false);
    expect(exists(foreign)).toBe(true);
    expect(await eventsOf(jobId)).toContain("move-partials-swept");
    // Swept once: never looked at again.
    expect(await sweep()).toEqual([]);
  });

  it("after the final failure of the last attempt, removes them too", async () => {
    const own = put(e, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`, "aaaa");
    await seedJob({ status: "failed", partials: [own] });
    await sweep();
    expect(exists(own)).toBe(false);
  });

  it("keeps a queued (lost run, put back) or running Job's partials to resume", async () => {
    const queued = put(e, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`, "aaaa");
    const running = put(e, `raw-footage/b.mkv${MOVE_PARTIAL_SUFFIX}`, "bb");
    await seedJob({ status: "queued", partials: [queued] });
    await seedJob({ status: "running", partials: [running] });
    expect(await sweep()).toEqual([]);
    expect(exists(queued)).toBe(true);
    expect(exists(running)).toBe(true);
  });

  it("a drive that disconnected keeps them until it is back", async () => {
    const own = put(e, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`, "aaaa");
    const jobId = await seedJob({ status: "failed", partials: [own] });
    const away = path.join(base, "e-away");
    fs.renameSync(e, away);
    const [first] = await sweep();
    expect(first?.removed.kept[0]?.reason).toMatch(/Offline/);
    expect(await eventsOf(jobId)).not.toContain("move-partials-swept");
    fs.renameSync(away, e);
    await sweep();
    expect(exists(own)).toBe(false);
    expect(await eventsOf(jobId)).toContain("move-partials-swept");
  });

  it("never deletes a recorded path outside the target's folder, or not named as a partial", async () => {
    const elsewhere = put(d, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`, "a");
    const footage = put(e, "raw-footage/real.mkv", "real");
    const escape = path.join(e, "raw-footage", "..", "x.cvm-move-partial");
    fs.writeFileSync(escape, "x");
    const jobId = await seedJob({
      status: "failed",
      partials: [elsewhere, footage, escape],
    });
    const [result] = await sweep();
    expect(result?.removed.files).toBe(0);
    expect(result?.removed.kept).toHaveLength(3);
    for (const p of [elsewhere, footage, escape]) expect(exists(p)).toBe(true);
    expect(await eventsOf(jobId)).not.toContain("move-partials-swept");
  });

  it("never deletes through a target folder that is a link elsewhere", async () => {
    const outside = path.join(base, "outside");
    put(outside, `a.mkv${MOVE_PARTIAL_SUFFIX}`, "a");
    fs.symlinkSync(outside, path.join(e, "raw-footage"));
    await seedJob({
      status: "failed",
      partials: [partialOn(e, "raw-footage/a.mkv")],
    });
    const [result] = await sweep();
    expect(result?.removed.files).toBe(0);
    expect(exists(path.join(outside, `a.mkv${MOVE_PARTIAL_SUFFIX}`))).toBe(
      true
    );
  });

  it("never touches a Job whose target is no longer a Storage Root", async () => {
    const other = path.join(base, "f");
    const own = put(other, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`, "a");
    await seedJob({ status: "failed", partials: [own], target: other });
    expect(await sweep()).toEqual([]);
    expect(exists(own)).toBe(true);
  });
});

describe("the Storage page", () => {
  it("counts a partial in its own bucket, never as Footage", async () => {
    const ownership = await Effect.runPromise(
      loadStorageOwnership(db(), roots)
    );
    expect(
      classifyStorageFile(ownership, `raw-footage/a.mkv${MOVE_PARTIAL_SUFFIX}`)
    ).toEqual({
      bucketId: "move-partials",
      kind: "other",
      role: "move-partial",
      companionOf: null,
    });
    expect(classifyStorageFile(ownership, "raw-footage/a.mkv")?.bucketId).toBe(
      "unused-footage"
    );
  });
});
