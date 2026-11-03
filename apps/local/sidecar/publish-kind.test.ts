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
import { defineJobKind } from "./job-kind";
import { enqueueJob, retryJob, type JobKindRegistry } from "./job-kinds";
import { makeJsonLogger } from "./json-logger";
import { UPLOAD_MANAGER_POLICIES } from "./retry-policy";
import { runSidecar, type SidecarTiming } from "./sidecar";

/**
 * THE PUBLISH GUARD (batch 6 of docs/plans/background-jobs-sidecar.md).
 * A Publish runs ONCE and is never run again on its own:
 *
 * - 1 attempt (every browser failure was `UPLOAD_FATAL_ERROR`);
 * - one at a time, in the `publish` lane (the service's semaphore is gone);
 * - not put back by a deliberate stop (section 7.5's rule does not apply),
 *   nor re-run after a crash: a run cut off after Submit leaves a Pending
 *   Version that only the author Promotes or Discards (section 7.2);
 * - no Retry: the author starts a new Publish from the page or the CLI.
 *
 * If this file fails, a Publish can run twice on its own.
 */

// -- A real sidecar, on PGlite ------------------------------------------------

let testDb: TestDb;
let dir: string;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-publish-kind-"));
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
      makeJsonLogger({ logDir: dir, write: () => {} })
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

const startSidecar = (registry: JobKindRegistry<never>, name: string) =>
  Effect.gen(function* () {
    const stop = yield* Deferred.make<string>();
    const serving = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      runSidecar({
        identity: {
          holder: `${name}-holder`,
          pid: process.pid,
          hostname: "test",
          checkout: `/checkouts/${name}`,
          gitSha: "abc1234",
          socket: path.join(dir, `${name}.sock`),
        },
        registry,
        timing: TIMING,
        stop,
        serve: () => Deferred.succeed(serving, undefined),
      })
    );
    yield* Deferred.await(serving);
    return {
      stop: Deferred.succeed(stop, "SIGTERM").pipe(
        Effect.zipRight(Fiber.join(fiber))
      ),
    };
  });

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

const eventTypes = (id: string) =>
  JobOperationsService.pipe(
    Effect.flatMap((ops) => ops.listJobEvents(id)),
    Effect.map((events) => events.map((e) => e.type))
  );

/** A Publish with the real kind's policy that counts its runs and hangs. */
const stubPublish = () => {
  const runs: string[] = [];
  let running = 0;
  let mostAtOnce = 0;
  const kind = defineJobKind({
    ...UPLOAD_MANAGER_POLICIES.publish,
    params: Schema.Struct({ hangMs: Schema.Number }),
    run: (params, ctx) =>
      Effect.gen(function* () {
        runs.push(ctx.jobId);
        running++;
        mostAtOnce = Math.max(mostAtOnce, running);
        yield* Effect.sleep(params.hangMs).pipe(
          Effect.ensuring(Effect.sync(() => running--))
        );
      }),
  });
  return {
    registry: { publish: kind },
    runs: (id: string) => runs.filter((r) => r === id).length,
    mostAtOnce: () => mostAtOnce,
  };
};

const enqueuePublish = (registry: JobKindRegistry<never>, hangMs: number) =>
  enqueueJob({
    id: null,
    kind: "publish",
    title: "a Publish",
    params: { hangMs },
    dependsOn: null,
    subject: { type: "course", id: "course-1" },
    attemptsSpent: 0,
    registry,
  });

describe("a Publish Job in the sidecar", () => {
  it.live(
    "cut off by a deliberate stop is NOT put back: interrupted, and the next sidecar never runs it",
    () =>
      Effect.gen(function* () {
        const stub = stubPublish();
        const first = yield* startSidecar(stub.registry, "a");
        const job = yield* enqueuePublish(stub.registry, 60_000);
        yield* waitForJob(job.id, (j) => j.status === "running");
        yield* first.stop;

        const ops = yield* JobOperationsService;
        expect(yield* ops.getJob(job.id)).toMatchObject({
          status: "interrupted",
          attempt: 1,
          maxAttempts: 1,
          error: {
            tag: "JobInterrupted",
            message: expect.stringContaining("Promote or Discard"),
          },
        });
        expect(yield* eventTypes(job.id)).not.toContain("requeued");

        const second = yield* startSidecar(stub.registry, "b");
        yield* Effect.sleep(500);
        expect(stub.runs(job.id)).toBe(1);
        expect(yield* ops.getJob(job.id)).toMatchObject({
          status: "interrupted",
        });
        yield* second.stop;
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "left running by a sidecar that died is NOT re-run, even with attempts to spare: recovery ends it interrupted",
    () =>
      Effect.gen(function* () {
        const stub = stubPublish();
        const ops = yield* JobOperationsService;
        // A row with a second attempt left (written by an older sidecar, or
        // by hand): recovery must go by the kind, not by the row's counts.
        const job = yield* ops.enqueueJob({
          id: null,
          kind: "publish",
          title: "a Publish",
          lane: "publish",
          params: { hangMs: 0 },
          maxAttempts: 2,
          dependsOn: null,
          subject: { type: "course", id: "course-1" },
        });
        // A dead sidecar's claim, its lease already lapsed.
        yield* ops.claimNextJob({
          lane: "publish",
          holder: "dead",
          leaseMs: 1,
        });
        yield* Effect.sleep(5);

        const sidecar = yield* startSidecar(stub.registry, "a");
        yield* waitForJob(job.id, (j) => j.status !== "running");
        yield* Effect.sleep(1_500); // past a second recovery sweep
        const after = yield* ops.getJob(job.id);
        yield* sidecar.stop;
        expect({ runs: stub.runs(job.id), status: after?.status }).toEqual({
          runs: 0,
          status: "interrupted",
        });
        // A Publish's own words, not a post's: it was never a post.
        const message = (after?.error as { message?: string }).message ?? "";
        expect(message).toContain("Promote or Discard");
        expect(message).toContain("publish page");
        expect(message).not.toContain("post was cut off");
      }).pipe(Effect.provide(layer()))
  );

  it.live("has no Retry: the author starts a new Publish", () =>
    Effect.gen(function* () {
      const stub = stubPublish();
      const first = yield* startSidecar(stub.registry, "a");
      const job = yield* enqueuePublish(stub.registry, 60_000);
      yield* waitForJob(job.id, (j) => j.status === "running");
      yield* first.stop;
      const refused = yield* retryJob({
        jobId: job.id,
        attempt: 1,
        registry: stub.registry,
      }).pipe(Effect.flip);
      expect(refused._tag).toBe("JobNotRetryableError");
    }).pipe(Effect.provide(layer()))
  );

  it.live("two Publishes run one after the other, never together", () =>
    Effect.gen(function* () {
      const stub = stubPublish();
      const sidecar = yield* startSidecar(stub.registry, "a");
      const a = yield* enqueuePublish(stub.registry, 300);
      const b = yield* enqueuePublish(stub.registry, 300);
      yield* waitForJob(a.id, (j) => j.status === "succeeded");
      yield* waitForJob(b.id, (j) => j.status === "succeeded");
      expect(stub.mostAtOnce()).toBe(1);
      yield* sidecar.stop;
    }).pipe(Effect.provide(layer()))
  );
});
