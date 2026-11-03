import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  FREE_LOST_RUNS,
  JobOperationsService,
} from "./db-job-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

let testDb: TestDb;
let testLayer: Layer.Layer<JobOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const LEASE = 30_000;

const enqueue = (overrides: { kind: string; maxAttempts: number }) =>
  Effect.flatMap(JobOperationsService, (ops) =>
    ops.enqueueJob({
      id: null,
      kind: overrides.kind,
      title: "A job",
      lane: "default",
      params: {},
      maxAttempts: overrides.maxAttempts,
      dependsOn: null,
      subject: null,
    })
  );

const lapse = Effect.promise(() => new Promise((r) => setTimeout(r, 5)));

describe("a resumable kind's lost run (#2167)", () => {
  const loseRun = (holder: string) =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      yield* ops.claimNextJob({ lane: "default", holder, leaseMs: 1 });
      yield* lapse;
      return yield* ops.recoverExpiredJobs({
        holderGoneAfterMs: 0,
        neverRetryKinds: {},
        stillRunning: [],
        resumableKinds: ["storage-move"],
      });
    });

  it.effect(
    "goes back at the same attempt, even on its last, and other kinds still spend one",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const move = yield* enqueue({ kind: "storage-move", maxAttempts: 2 });
        const other = yield* enqueue({ kind: "export", maxAttempts: 2 });
        yield* ops.claimNextJob({ lane: "default", holder: "a", leaseMs: 1 });
        const recovered = yield* loseRun("b");
        expect(
          Object.fromEntries(recovered.map((r) => [r.jobId, r.outcome]))
        ).toEqual({ [move.id]: "requeued", [other.id]: "retrying" });
        expect(yield* ops.getJob(move.id)).toMatchObject({
          status: "queued",
          attempt: 1,
          holder: null,
        });
        expect(yield* ops.getJob(other.id)).toMatchObject({ attempt: 2 });
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("spends attempts again once it has lost FREE_LOST_RUNS runs", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const move = yield* enqueue({ kind: "storage-move", maxAttempts: 2 });
      for (let i = 0; i < FREE_LOST_RUNS; i++) {
        const [r] = yield* loseRun(`dead-${i}`);
        expect(r?.outcome).toBe("requeued");
      }
      expect((yield* ops.getJob(move.id))?.attempt).toBe(1);
      expect((yield* loseRun("dead-x"))[0]?.outcome).toBe("retrying");
      expect((yield* loseRun("dead-y"))[0]?.outcome).toBe("interrupted");
      const lost = (yield* ops.listJobEvents(move.id)).filter(
        (e) => e.type === "requeued"
      );
      expect(lost).toHaveLength(FREE_LOST_RUNS);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("a held run lost mid-run (failJobAttempt) resumes too", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const move = yield* enqueue({ kind: "storage-move", maxAttempts: 1 });
      yield* ops.claimNextJob({ lane: "default", holder: "h", leaseMs: LEASE });
      const outcome = yield* ops.failJobAttempt({
        jobId: move.id,
        holder: "h",
        failure: { tag: "JobInterrupted", message: "lost", cause: "lease" },
        interrupted: true,
        mayRetry: true,
        resumable: true,
      });
      expect(outcome).toBe("requeued");
      expect(yield* ops.getJob(move.id)).toMatchObject({
        status: "queued",
        attempt: 1,
      });
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("a resumable kind's real failure still spends an attempt", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const move = yield* enqueue({ kind: "storage-move", maxAttempts: 2 });
      yield* ops.claimNextJob({ lane: "default", holder: "h", leaseMs: LEASE });
      const outcome = yield* ops.failJobAttempt({
        jobId: move.id,
        holder: "h",
        failure: {
          tag: "StorageMoveFailedError",
          message: "E: is full",
          cause: "",
        },
        interrupted: false,
        mayRetry: true,
        resumable: true,
      });
      expect(outcome).toBe("retrying");
      expect((yield* ops.getJob(move.id))?.attempt).toBe(2);
    }).pipe(Effect.provide(testLayer))
  );
});
