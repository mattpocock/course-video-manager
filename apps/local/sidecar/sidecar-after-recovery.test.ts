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
import { makeJsonLogger } from "./json-logger";
import { runSidecar, type SidecarTiming } from "./sidecar";

/**
 * `runSidecar`'s `afterRecovery`: run-sidecar passes the stuck-Clip sweep
 * (`stuck-clip-sweep.ts`) there.
 */

const registry = { noop: noopJobKind } as const;

let testDb: TestDb;
let dir: string;
let stdout: string[];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-sidecar-sweep-"));
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

describe("the sidecar's after-recovery sweep", () => {
  it.live(
    "runs before the sidecar serves, then on every recovery tick, and a failing sweep never stops it",
    () =>
      Effect.gen(function* () {
        let runs = 0;
        let runsWhenServed = -1;
        const stop = yield* Deferred.make<string>();
        const serving = yield* Deferred.make<void>();
        const fiber = yield* Effect.fork(
          runSidecar({
            identity: {
              holder: "sweep-holder",
              pid: process.pid,
              hostname: "test",
              checkout: "/checkouts/sweep",
              gitSha: "abc1234",
              socket: path.join(dir, "sweep.sock"),
            },
            registry,
            timing: TIMING,
            stop,
            afterRecovery: Effect.suspend(() => {
              runs += 1;
              return Effect.fail("the sweep broke");
            }),
            serve: () =>
              Effect.sync(() => {
                runsWhenServed = runs;
              }).pipe(Effect.zipRight(Deferred.succeed(serving, undefined))),
          })
        );
        yield* Deferred.await(serving);
        expect(runsWhenServed).toBe(1);

        yield* Effect.sleep(TIMING.recoverEveryMs * 2 + 300);
        expect(runs).toBeGreaterThanOrEqual(3);
        expect(stdout.join("")).toContain(
          "sidecar: the after-recovery sweep failed"
        );

        yield* Deferred.succeed(stop, "test over");
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Stopped",
          reason: "test over",
        });
      }).pipe(Effect.provide(layer()))
  );
});
