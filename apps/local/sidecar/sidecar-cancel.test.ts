import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger, Schema } from "effect";
import {
  JobOperationsService,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { defineJobKind, JobCancelledError } from "./job-kind";
import { enqueueJob, type JobKindRegistry } from "./job-kinds";
import { makeJsonLogger } from "./json-logger";
import { runSidecar, type SidecarTiming } from "./sidecar";
import { serveSidecarSocket } from "./socket";

/**
 * The author's Cancel, through a running sidecar (#2109): a handler that
 * answers it ends its Job `cancelled`, on its first attempt, never retried.
 */

let testDb: TestDb;
let dir: string;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-sidecar-cancel-"));
  fs.mkdirSync(path.join(dir, "jobs"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const layer = () =>
  Layer.mergeAll(
    JobOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as any))
    ),
    Logger.replace(
      Logger.defaultLogger,
      makeJsonLogger({ logDir: path.join(dir, "jobs"), write: () => {} })
    )
  );

const TIMING: SidecarTiming = {
  leaseMs: 2_000,
  leaseRenewMs: 500,
  jobLeaseMs: 2_000,
  jobHeartbeatMs: 500,
  pollMs: 50,
  recoverEveryMs: 1_000,
  lapseWaitMs: 200,
  postCheckTimeoutMs: 1_000,
};

const waitForJob = (id: string, done: (job: Job) => boolean) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    for (let i = 0; i < 200; i++) {
      const job = yield* ops.getJob(id);
      if (job && done(job)) return job;
      yield* Effect.sleep(25);
    }
    return yield* Effect.dieMessage(`job ${id} never got there`);
  });

const registry = {
  cancellable: defineJobKind({
    lane: "default",
    maxAttempts: 2,
    params: Schema.Struct({}),
    run: (_params, ctx) =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        while (!(yield* Effect.orDie(ops.isJobCancelRequested(ctx.jobId)))) {
          yield* Effect.sleep(20);
        }
        return yield* new JobCancelledError({
          message: "Cancelled: nothing was left behind",
        });
      }),
  }),
} as unknown as JobKindRegistry<never>;

describe("the sidecar and the author's Cancel", () => {
  it.live("ends a Job cancelled when its handler answers the Cancel", () =>
    Effect.gen(function* () {
      const stop = yield* Deferred.make<string>();
      const socket = path.join(dir, "s.sock");
      const serving = yield* Deferred.make<void>();
      const fiber = yield* Effect.fork(
        runSidecar({
          identity: {
            holder: "h",
            pid: process.pid,
            hostname: "test",
            checkout: "/checkouts/x",
            gitSha: "abc1234",
            socket,
          },
          registry,
          timing: TIMING,
          stop,
          serve: (handle) =>
            serveSidecarSocket({
              socket,
              handle,
              registry,
              logDir: path.join(dir, "jobs"),
            }).pipe(Effect.zipRight(Deferred.succeed(serving, undefined))),
        })
      );
      yield* Deferred.await(serving);

      const job = yield* enqueueJob({
        id: null,
        kind: "cancellable",
        title: "cancellable",
        params: {},
        dependsOn: null,
        subject: null,
        attemptsSpent: 0,
        registry,
      });
      yield* waitForJob(job.id, (j) => j.status === "running");
      const ops = yield* JobOperationsService;
      yield* ops.requestJobCancel({ jobId: job.id, kinds: ["cancellable"] });

      const done = yield* waitForJob(
        job.id,
        (j) => !["queued", "running"].includes(j.status)
      );
      expect(done.status).toBe("cancelled");
      expect(done.attempt).toBe(1);
      expect((yield* ops.listJobEvents(job.id)).at(-1)?.type).toBe("cancelled");

      yield* Deferred.succeed(stop, "test over");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(layer()))
  );
});
