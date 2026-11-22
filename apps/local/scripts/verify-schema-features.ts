/**
 * Runs the schema feature probes against a real database and prints a verdict
 * per feature. This is the executable form of the hand-verification step in
 * the PlanetScale cutover: point it at the hosted branch once its migrations
 * have run, and paste the output onto the issue.
 *
 *   pnpm run db:verify-features   # repo-root .env, or DATABASE_URL=… to override
 *
 * Read-only — it queries the catalogue and evaluates literals, and writes
 * nothing. Uses the direct connection string when one is configured, so it
 * sees the primary rather than a pooled session.
 */
import { SCHEMA_FEATURE_PROBES } from "@/db/schema-feature-probes";
import { scriptPgClient } from "./script-database-url";
import { log } from "@/packages/log";

const { client } = scriptPgClient({ direct: true });
await client.connect();

let failures = 0;
try {
  for (const probe of SCHEMA_FEATURE_PROBES) {
    const result = await client.query(probe.sql);
    const verdict = probe.check(result.rows);
    if (!verdict.ok) failures++;
    log.info(
      `${verdict.ok ? "PASS" : "FAIL"}  ${probe.name}\n      ${verdict.detail}`
    );
  }
} finally {
  await client.end();
}

if (failures > 0) {
  log.error(`\n${failures} feature(s) unsupported — do not cut over.`);
  process.exit(1);
}
log.info("\nAll schema features verified.");
