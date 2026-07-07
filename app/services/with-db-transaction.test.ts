import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Data, Effect, Exit } from "effect";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import { createBeatOperations } from "@/services/db-beat-operations.server";
import { beats, videos } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import type { Database } from "@/services/drizzle-service.server";

class ForcedTestError extends Data.TaggedError("ForcedTestError")<{
  message: string;
}> {}

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const makeVideo = async (id: string) => {
  await testDb.insert(videos).values({
    id,
    path: `${id}.mp4`,
    originalFootagePath: `/footage/${id}`,
  });
};

describe("withDbTransaction", () => {
  it.effect("commits all writes when the effect succeeds", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));

      const result = yield* withDbTransaction(testDb as any, (tx) =>
        Effect.gen(function* () {
          const segOps = createBeatOperations(tx as any);
          const seg = yield* segOps.createBeat("video-1");
          return seg;
        })
      );

      expect(result.videoId).toBe("video-1");

      const rows = yield* Effect.promise(() =>
        testDb.query.beats.findMany({
          where: eq(beats.videoId, "video-1"),
        })
      );
      expect(rows).toHaveLength(1);
    })
  );

  it.effect("rolls back all writes on failure — no partial state remains", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));

      const exit = yield* Effect.exit(
        withDbTransaction(testDb as any, (tx) =>
          Effect.gen(function* () {
            const segOps = createBeatOperations(tx as any);
            yield* segOps.createBeat("video-1");
            yield* segOps.createBeat("video-1");
            return yield* new ForcedTestError({
              message: "deliberate failure",
            });
          })
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);

      const rows = yield* Effect.promise(() =>
        testDb.query.beats.findMany({
          where: eq(beats.videoId, "video-1"),
        })
      );
      expect(rows).toHaveLength(0);
    })
  );

  it.effect("preserves the typed error through rollback", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));

      const error = yield* Effect.flip(
        withDbTransaction(testDb as any, (_tx) =>
          Effect.gen(function* () {
            return yield* new ForcedTestError({
              message: "preserved error",
            });
          })
        )
      );

      expect(error._tag).toBe("ForcedTestError");
      expect((error as ForcedTestError).message).toBe("preserved error");
    })
  );

  it.effect(
    "ops-service factories accept a transaction handle and typecheck",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => makeVideo("video-1"));

        yield* withDbTransaction(testDb as any, (tx: Database) =>
          Effect.gen(function* () {
            const segOps = createBeatOperations(tx as any);
            const seg = yield* segOps.createBeat("video-1");
            expect(seg.videoId).toBe("video-1");
          })
        );
      })
  );
});
