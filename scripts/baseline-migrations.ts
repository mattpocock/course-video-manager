import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { resolveMigrationDatabaseUrl } from "../app/db/database-url";

const MIGRATIONS_DIR = join(import.meta.dirname, "../app/db/migrations");

const journalPath = join(MIGRATIONS_DIR, "meta/_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
const baseline = journal.entries[0];

if (!baseline || baseline.idx !== 0) {
  console.error("No baseline (idx=0) entry found in _journal.json");
  process.exit(1);
}

const sqlContent = readFileSync(
  join(MIGRATIONS_DIR, `${baseline.tag}.sql`),
  "utf-8"
);
const hash = createHash("sha256").update(sqlContent).digest("hex");

// This writes to drizzle's migration bookkeeping, so it runs through the
// direct connection like every other migration step.
const url = resolveMigrationDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const existing = await client.query(
    `SELECT id FROM drizzle.__drizzle_migrations
     WHERE hash = $1 AND created_at = $2`,
    [hash, baseline.when]
  );

  if (existing.rows.length > 0) {
    console.log("Baseline migration already registered — nothing to do.");
  } else {
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
       VALUES ($1, $2)`,
      [hash, baseline.when]
    );
    console.log(
      `Registered baseline migration ${baseline.tag} (hash=${hash.slice(0, 12)}…, when=${baseline.when})`
    );
  }
} finally {
  await client.end();
}
