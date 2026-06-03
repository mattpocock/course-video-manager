import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { readFileSync } from "node:fs";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

async function getSnapshotPath(): Promise<string | undefined> {
  try {
    const { inject } = await import("vitest");
    return inject("pgliteSnapshotPath");
  } catch {
    return undefined;
  }
}

/**
 * Creates a single PGlite instance and migrates the schema once.
 *
 * Designed for use in `beforeAll` — spinning up one PGlite per file
 * instead of per test is significantly faster (~4-5x) because PGlite
 * boot + schema push is the expensive part, not the queries themselves.
 *
 * Use {@link truncateAllTables} in `beforeEach` to reset state between tests.
 */
export const createTestDb = async () => {
  const snapshotPath = await getSnapshotPath();

  if (snapshotPath) {
    const blob = new Blob([readFileSync(snapshotPath)]);
    const pglite = new PGlite({ loadDataDir: blob });
    const testDb = drizzle(pglite, { schema });
    return { pglite, testDb };
  }

  const { pushSchema } = await import("drizzle-kit/api");
  const pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  const { apply } = await pushSchema(schema, testDb as any);
  await apply();
  return { pglite, testDb };
};

/**
 * Truncates every table in the public schema with CASCADE.
 *
 * Call this in `beforeEach` to give each test a clean database
 * without the overhead of recreating the PGlite instance.
 */
export const truncateAllTables = async (testDb: TestDb) => {
  await testDb.execute(sql`DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;`);
};
