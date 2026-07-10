import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

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

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url);

try {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const existing = await sql`
    SELECT id FROM drizzle.__drizzle_migrations
    WHERE hash = ${hash} AND created_at = ${baseline.when}
  `;

  if (existing.length > 0) {
    console.log("Baseline migration already registered — nothing to do.");
  } else {
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${baseline.when})
    `;
    console.log(
      `Registered baseline migration ${baseline.tag} (hash=${hash.slice(0, 12)}…, when=${baseline.when})`
    );
  }
} finally {
  await sql.end();
}
