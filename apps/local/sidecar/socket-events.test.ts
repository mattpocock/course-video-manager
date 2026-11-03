import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger } from "effect";
import { sql } from "drizzle-orm";
import { jobEvents } from "@cvm/core/db/schema";
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
import { enqueueJob } from "./job-kinds";
import { noopJobKind } from "./kinds/noop";
import { runSidecar } from "./sidecar";
import { serveSidecarSocket } from "./socket";

/** The sidecar's `/events` as the app's proxy meets it. */

const JOB_KINDS = { noop: noopJobKind } as const;

let testDb: TestDb;
let dir: string;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-sidecar-events-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const layer = () =>
  Layer.mergeAll(
    JobOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as any))
    ),
    Logger.replace(Logger.defaultLogger, Logger.none)
  );

/** Start a sidecar in the background; resolves once its socket answers. */
const startSidecar = Effect.gen(function* () {
  const stop = yield* Deferred.make<string>();
  const socket = path.join(dir, "sidecar.sock");
  const serving = yield* Deferred.make<void>();
  const fiber = yield* Effect.fork(
    runSidecar({
      identity: {
        holder: "events-holder",
        pid: process.pid,
        hostname: "test",
        checkout: "/checkouts/events",
        gitSha: "abc1234",
        socket,
      },
      registry: JOB_KINDS,
      timing: {
        leaseMs: 2_000,
        leaseRenewMs: 500,
        jobLeaseMs: 2_000,
        jobHeartbeatMs: 500,
        pollMs: 50,
        recoverEveryMs: 1_000,
        lapseWaitMs: 200,
        postCheckTimeoutMs: 1_000,
      },
      stop,
      serve: (handle) =>
        serveSidecarSocket({
          socket,
          handle,
          registry: JOB_KINDS,
          logDir: dir,
        }).pipe(Effect.zipRight(Deferred.succeed(serving, undefined))),
    })
  );
  yield* Deferred.await(serving);
  return { stop, fiber, socket };
});

const enqueue = enqueueJob({
  id: null,
  kind: "noop",
  title: "noop",
  params: {},
  dependsOn: null,
  subject: null,
  attemptsSpent: 0,
  registry: JOB_KINDS,
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

const finished = (job: Job) => !["queued", "running"].includes(job.status);

describe("the sidecar's /events", () => {
  it.live(
    "answers a reconnect with nothing to replay at once, so the app does not take the sidecar for down",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar;
        const ops = yield* JobOperationsService;
        const done = yield* enqueue;
        yield* waitForJob(done.id, finished);
        const newest = yield* ops.latestJobEventId();
        // All of it an hour ago: nothing for the feed to stream again either.
        yield* Effect.promise(() =>
          testDb.execute(
            sql`UPDATE ${jobEvents} SET at = at - interval '1 hour'`
          )
        );

        // The tab has seen everything; the app's proxy gives up on a sidecar
        // that sends no headers within 3 s and reports it not running.
        const status = yield* Effect.async<number>((resume) => {
          const req = http.get({
            socketPath: socket,
            path: "/events",
            headers: { "last-event-id": String(newest) },
          });
          req.on("response", (res) => {
            resume(Effect.succeed(res.statusCode ?? 0));
            req.destroy();
          });
          req.on("error", () => {});
          return Effect.sync(() => req.destroy());
        }).pipe(Effect.timeout(1_000));
        expect(status).toBe(200);

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer()))
  );
});
