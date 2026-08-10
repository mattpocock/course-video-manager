import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema";
import { SCHEMA_FEATURE_PROBES } from "./schema-feature-probes";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "migrations");

/**
 * The probes are the executable form of the hand-verification checklist for a
 * hosted Postgres (PlanetScale). PGlite cannot prove PlanetScale compatibility
 * — that run is manual, via `pnpm run db:verify-features` — but it can prove
 * the probes themselves are right: they must all pass against this repo's own
 * migrations.
 */
describe("schema feature probes", () => {
  let pglite: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pglite = new PGlite();
    db = drizzle(pglite, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("covers every feature the hosted database is at risk of not supporting", () => {
    expect(SCHEMA_FEATURE_PROBES.map((p) => p.name)).toEqual([
      'COLLATE "C" ordering',
      "generated tsvector STORED columns",
      "GIN indexes",
      "partial unique indexes",
      "text[] columns",
    ]);
  });

  it("fails every probe against a database with none of the features", () => {
    // Guards the suite against a probe that passes vacuously: a database whose
    // catalogue query returns nothing must fail, not pass.
    for (const probe of SCHEMA_FEATURE_PROBES) {
      expect({ name: probe.name, ...probe.check([]) }).toEqual({
        name: probe.name,
        ok: false,
        detail: expect.any(String),
      });
    }
  });

  for (const probe of SCHEMA_FEATURE_PROBES) {
    it(`passes: ${probe.name}`, async () => {
      const result = await db.execute<Record<string, unknown>>(
        sql.raw(probe.sql)
      );
      expect({ name: probe.name, ...probe.check(result.rows) }).toEqual({
        name: probe.name,
        ok: true,
        detail: expect.any(String),
      });
    });
  }
});
