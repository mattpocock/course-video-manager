/**
 * Runs the schema feature probes against a real database and prints a verdict
 * per feature. This is the executable form of the hand-verification step in
 * the PlanetScale cutover: point it at the hosted branch once its migrations
 * have run, and paste the output onto the issue.
 *
 *   DATABASE_URL="postgres://…" pnpm run db:verify-features
 *
 * Read-only — it queries the catalogue and evaluates literals, and writes
 * nothing. Uses the direct connection string when one is configured, so it
 * sees the primary rather than a pooled session.
 */
import { Client } from "pg";
import { resolveMigrationDatabaseUrl } from "../app/db/database-url";
import { SCHEMA_FEATURE_PROBES } from "../app/db/schema-feature-probes";

const url = resolveMigrationDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

let failures = 0;
try {
  for (const probe of SCHEMA_FEATURE_PROBES) {
    const result = await client.query(probe.sql);
    const verdict = probe.check(result.rows);
    if (!verdict.ok) failures++;
    console.log(
      `${verdict.ok ? "PASS" : "FAIL"}  ${probe.name}\n      ${verdict.detail}`
    );
  }
} finally {
  await client.end();
}

if (failures > 0) {
  console.error(`\n${failures} feature(s) unsupported — do not cut over.`);
  process.exit(1);
}
console.log("\nAll schema features verified.");
