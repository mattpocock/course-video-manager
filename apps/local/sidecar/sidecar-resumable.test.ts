import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { noopJobKind } from "./kinds/noop";
import { defineJobKind } from "./job-kind";
import { JOB_PARAMS } from "./job-params";

const JOB_PARAMS_POLICY = {
  lane: "default",
  maxAttempts: 1,
  resumable: true,
} as const;
import { makeJsonLogger } from "./json-logger";
import { runSidecar, type SidecarTiming } from "./sidecar";

/**
 * A resumable kind's lost run (#2167): recovery puts it back at the same
 * attempt, wired through the kind's policy, and the next run finishes it.
 */

const resumableNoop = defineJobKind({
  ...JOB_PARAMS_POLICY,
  params: JOB_PARAMS["noop"],
  run: (params, ctx) => noopJobKind.runRaw(params, ctx),
});
const registry = { noop: resumableNoop } as const;

let testDb: TestDb;
let dir: string;
let stdout: string[];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-sidecar-resumable-"));
  stdout = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const layer = () =>
  Layer.mergeAll(
    JobOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as never))
    ),
    Logger.replace(
      Logger.defaultLogger,
      makeJsonLogger({ logDir: dir, write: (text) => stdout.push(text) })
    )
  );

const TIMING: SidecarTiming = {
  leaseMs: 2_000,
  leaseRenewMs: 500,
  jobLeaseMs: 2_000,
  jobHeartbeatMs: 500,
  pollMs: 50,
  recoverEveryMs: 500,
  lapseWaitMs: 200,
  postCheckTimeoutMs: 1_000,
};

describe("a resumable kind's lost run", () => {
  it.live("goes back at the same attempt on its last, and then succeeds", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* ops.enqueueJob({
        id: null,
        kind: "noop",
        title: "a long move",
        lane: "default",
        params: { durationMs: 0, failAttempts: 0 },
        maxAttempts: 1,
        dependsOn: null,
        subject: null,
      });
      // A sidecar that died mid-run: its lease lapses.
      yield* ops.claimNextJob({ lane: "default", holder: "dead", leaseMs: 1 });
      yield* Effect.sleep(5);

      const stop = yield* Deferred.make<string>();
      const fiber = yield* Effect.fork(
        runSidecar({
          identity: {
            holder: "next-holder",
            pid: process.pid,
            hostname: "test",
            checkout: "/checkouts/next",
            gitSha: "abc1234",
            socket: path.join(dir, "next.sock"),
          },
          registry,
          timing: TIMING,
          stop,
          serve: () => Effect.void,
        })
      );
      let status = "";
      for (let i = 0; i < 100 && status !== "succeeded"; i++) {
        yield* Effect.sleep(50);
        status = (yield* ops.getJob(job.id))?.status ?? "";
      }
      expect(yield* ops.getJob(job.id)).toMatchObject({
        status: "succeeded",
        attempt: 1,
      });
      const types = (yield* ops.listJobEvents(job.id)).map((e) => e.type);
      expect(types).toContain("requeued");
      expect(types).not.toContain("retrying");
      expect(types).not.toContain("interrupted");

      yield* Deferred.succeed(stop, "test over");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(layer()))
  );
});
