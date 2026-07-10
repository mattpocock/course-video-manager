import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { pushSchema } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "migrations");

describe("drizzle migrations", () => {
  it("applies the baseline migration on a fresh database", async () => {
    const pglite = new PGlite();
    const db = drizzle(pglite, { schema });

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const tables = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const tableNames = tables.rows.map((r) => r.tablename);

    expect(tableNames).toContain("course-video-manager_course");
    expect(tableNames).toContain("course-video-manager_video");
    expect(tableNames).toContain("course-video-manager_diagram");
    expect(tableNames).toContain("course-video-manager_diagram_snapshot");

    await pglite.close();
  });

  it("is a no-op when the baseline is already registered", async () => {
    const pglite = new PGlite();
    const db = drizzle(pglite, { schema });

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const before = await db.execute<{ id: number }>(
      sql`SELECT id FROM drizzle.__drizzle_migrations`
    );
    const migrationCount = before.rows.length;
    expect(migrationCount).toBeGreaterThanOrEqual(1);

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const after = await db.execute<{ id: number }>(
      sql`SELECT id FROM drizzle.__drizzle_migrations`
    );
    expect(after.rows).toHaveLength(migrationCount);

    await pglite.close();
  });

  it("baseline SQL hash matches what readMigrationFiles would compute", async () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf-8")
    );
    const baseline = journal.entries[0];
    const sqlContent = readFileSync(
      join(MIGRATIONS_FOLDER, `${baseline.tag}.sql`),
      "utf-8"
    );
    const expectedHash = createHash("sha256").update(sqlContent).digest("hex");

    const pglite = new PGlite();
    const db = drizzle(pglite, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const rows = await db.execute<{ hash: string; created_at: string }>(
      sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`
    );

    expect(rows.rows[0]!.hash).toBe(expectedHash);
    expect(Number(rows.rows[0]!.created_at)).toBe(baseline.when);

    await pglite.close();
  });

  it("migrate produces the same public-schema tables as pushSchema", async () => {
    const getPublicTables = async (db: ReturnType<typeof drizzle>) => {
      const result = await db.execute<{ tablename: string }>(
        sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      );
      return result.rows.map((r) => r.tablename);
    };

    const migratePg = new PGlite();
    const migrateDb = drizzle(migratePg, { schema });
    await migrate(migrateDb, { migrationsFolder: MIGRATIONS_FOLDER });
    const migrateTables = await getPublicTables(migrateDb);

    const pushPg = new PGlite();
    const pushDb = drizzle(pushPg, { schema });
    const { apply } = await pushSchema(schema, pushDb as any);
    await apply();
    const pushTables = await getPublicTables(pushDb);

    expect(migrateTables).toEqual(pushTables);

    await migratePg.close();
    await pushPg.close();
  });
});
