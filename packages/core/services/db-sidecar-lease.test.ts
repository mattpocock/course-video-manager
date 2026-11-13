import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { JobOperationsService } from "./db-job-operations.server.js";
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

const lapse = Effect.promise(() => new Promise((r) => setTimeout(r, 5)));

describe("the sidecar lease", () => {
  const take = (holder: string, leaseMs: number) =>
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.acquireSidecarLease({
        holder,
        pid: 1,
        hostname: "box",
        checkout: `/repo/${holder}`,
        gitSha: "abc",
        socket: "/tmp/s.sock",
        leaseMs,
      })
    );

  it.effect(
    "goes to one sidecar at a time, and to the next once it lapses",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        expect((yield* take("first", 1)).acquired).toBe(true);
        expect((yield* take("first", LEASE)).acquired).toBe(true);

        const refused = yield* take("second", LEASE);
        expect(refused).toMatchObject({
          acquired: false,
          lease: { holder: "first", checkout: "/repo/first" },
        });

        yield* ops.releaseSidecarLease("first");
        yield* lapse;
        expect((yield* take("second", LEASE)).acquired).toBe(true);
        expect(
          yield* ops.renewSidecarLease({ holder: "first", leaseMs: LEASE })
        ).toBe(false);
      }).pipe(Effect.provide(testLayer))
  );

  // A renewal still in flight when its sidecar stops can land after the
  // release, on another pooled connection. It must not take the lease back,
  // or the next sidecar is refused for a whole `leaseMs`.
  it.effect(
    "once released, a late renewal from its holder does not take it back: the next sidecar takes it at once",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        expect((yield* take("first", LEASE)).acquired).toBe(true);

        yield* ops.releaseSidecarLease("first");
        expect(
          yield* ops.renewSidecarLease({ holder: "first", leaseMs: LEASE })
        ).toBe(false);
        expect((yield* take("second", LEASE)).acquired).toBe(true);
      }).pipe(Effect.provide(testLayer))
  );
});
