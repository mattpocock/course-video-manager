import { Effect, Exit, Cause } from "effect";
import { sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { createTestDb, type TestDb } from "@/test-utils/test-db";
import { schemaBehindMessageOf } from "@/services/schema-behind.server";
import { loadStorageOwnership } from "../scan";

/**
 * A database a pending migration has not reached yet: here, one without the
 * Footage Layer table (0048_clip_layer), as the author's was when the
 * Imported Footage page answered a bare 500.
 */
let testDb: TestDb;

beforeAll(async () => {
  ({ testDb } = await createTestDb());
  await testDb.execute(
    sql.raw(`DROP TABLE "course-video-manager_clip_layer" CASCADE`)
  );
});

it("keeps Postgres's reason when the database lacks a table it reads, so the route can say to migrate", async () => {
  const exit = await Effect.runPromiseExit(
    loadStorageOwnership(testDb as unknown as Database, ["/storage-root"])
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return;
  const message = schemaBehindMessageOf(Cause.squash(exit.cause));
  expect(message).toContain(
    'relation "course-video-manager_clip_layer" does not exist'
  );
  expect(message).toContain("pnpm db:migrate");
});
