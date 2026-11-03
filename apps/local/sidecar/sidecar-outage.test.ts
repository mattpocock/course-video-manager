import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger } from "effect";
import { sql } from "drizzle-orm";
import {
  JobOperationsService,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import { UnknownDBServiceError } from "@cvm/core/services/db-service-errors";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { enqueueJob } from "./job-kinds";
import { noopJobKind } from "./kinds/noop";
import { makeJsonLogger } from "./json-logger";
import { runSidecar, type SidecarTiming } from "./sidecar";

/**
 * A database outage through a running sidecar (#2621). On 2026-11-02 DNS for
 * the database failed for a moment, an hour into a Publish; the sidecar
 * stopped one lease (15 s) later and took the Publish with it. It now runs on
 * through the outage, and stops only on proof of a takeover or after its
 * outage tolerance.
 */

const JOB_KINDS = { noop: noopJobKind } as const;

let testDb: TestDb;
let dir: string;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-sidecar-outage-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const TIMING: SidecarTiming = {
  leaseMs: 2_000,
  outageToleranceMs: 4_000,
  leaseRenewMs: 500,
  jobLeaseMs: 2_000,
  jobHeartbeatMs: 500,
  pollMs: 50,
  recoverEveryMs: 1_000,
  lapseWaitMs: 200,
  postCheckTimeoutMs: 1_000,
};

/**
 * The real Job operations behind a switch: while `down`, every call fails as
 * a DNS outage does (`ENOTFOUND`), without reaching the database.
 */
const outage = () => {
  const state = { down: false };
  const unreachable = () =>
    Effect.fail(
      new UnknownDBServiceError({
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND db.example"), {
          code: "ENOTFOUND",
        }),
      })
    );
  const layer = Layer.mergeAll(
    Layer.effect(
      JobOperationsService,
      Effect.map(
        JobOperationsService,
        (ops) =>
          new Proxy(ops, {
            get: (target, key, receiver) => {
              const value = Reflect.get(target, key, receiver);
              return typeof value === "function"
                ? (...args: unknown[]) =>
                    // Judged at each run: the sidecar builds some calls
                    // (the lease renewal) once and runs them again and again.
                    Effect.suspend(() =>
                      state.down ? unreachable() : value(...args)
                    )
                : value;
            },
          })
      )
    ).pipe(Layer.provide(JobOperationsService.Default)),
    Logger.replace(
      Logger.defaultLogger,
      makeJsonLogger({ logDir: dir, write: () => {} })
    )
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));
  return { state, layer };
};

const startSidecar = Effect.gen(function* () {
  const stop = yield* Deferred.make<string>();
  const serving = yield* Deferred.make<void>();
  const fiber = yield* Effect.fork(
    runSidecar({
      identity: {
        holder: "first-holder",
        pid: process.pid,
        hostname: "test",
        checkout: "/checkouts/first",
        gitSha: "abc1234",
        socket: path.join(dir, "first.sock"),
      },
      registry: JOB_KINDS,
      timing: TIMING,
      stop,
      serve: () => Deferred.succeed(serving, undefined),
    })
  );
  yield* Deferred.await(serving);
  return { stop, fiber };
});

const waitForJob = (id: string, done: (job: Job) => boolean) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    for (let i = 0; i < 200; i++) {
      const job = yield* ops.getJob(id);
      if (job && done(job)) return job;
      yield* Effect.sleep(25);
    }
    return yield* Effect.dieMessage(
      `job ${id} never reached the expected state`
    );
  });

describe("the sidecar through a database outage (#2621)", () => {
  it.live(
    "keeps running its Jobs through an outage longer than the lease",
    () => {
      const db = outage();
      return Effect.gen(function* () {
        const { stop, fiber } = yield* startSidecar;
        const job = yield* enqueueJob({
          id: null,
          kind: "noop",
          title: "noop",
          params: { durationMs: 3_500 },
          dependsOn: null,
          subject: null,
          attemptsSpent: 0,
          registry: JOB_KINDS,
        });
        yield* waitForJob(job.id, (j) => j.status === "running");

        // Longer than the 2 s lease, shorter than the 4 s tolerance.
        db.state.down = true;
        yield* Effect.sleep(2_800);
        db.state.down = false;

        const done = yield* waitForJob(
          job.id,
          (j) => !["queued", "running"].includes(j.status)
        );
        expect(done).toMatchObject({ status: "succeeded", attempt: 1 });
        expect(fiber.unsafePoll()).toBeNull();

        yield* Deferred.succeed(stop, "test over");
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Stopped",
          reason: "test over",
        });
      }).pipe(Effect.provide(db.layer));
    },
    20_000
  );

  it.live(
    "stops once the database has been unreachable for the outage tolerance",
    () => {
      const db = outage();
      return Effect.gen(function* () {
        const { fiber } = yield* startSidecar;
        const downAt = Date.now();
        db.state.down = true;
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Stopped",
          reason: "lease lapsed",
        });
        expect(Date.now() - downAt).toBeGreaterThanOrEqual(4_000);
      }).pipe(Effect.provide(db.layer));
    },
    20_000
  );

  it.live(
    "stops at once, after an outage, when another sidecar took the lease meanwhile",
    () => {
      const db = outage();
      return Effect.gen(function* () {
        const { fiber } = yield* startSidecar;
        db.state.down = true;
        yield* Effect.sleep(1_000);
        yield* Effect.promise(() =>
          testDb.execute(
            sql`UPDATE "course-video-manager_sidecar_lease" SET holder = 'second-holder'`
          )
        );
        db.state.down = false;
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Stopped",
          reason: "lease lost",
        });
      }).pipe(Effect.provide(db.layer));
    },
    20_000
  );
});
