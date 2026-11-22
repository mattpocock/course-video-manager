/**
 * Runs before `pnpm dev` / `pnpm start`: warns, loudly, when the database
 * apps/local talks to has not applied every migration in this checkout.
 *
 * Day to day that database is production (PlanetScale), and migrations are
 * applied by hand (ADR 0026). So after a `git pull` that brings in a migration,
 * this checkout's code can select a column production does not have yet until
 * Matt runs `pnpm db:migrate` — and the failure shows up as a broken page, not
 * as a reason. This names the reason before the server starts.
 *
 * READ-ONLY: one SELECT on Drizzle's bookkeeping table. It never migrates, and
 * it never blocks startup — an unreachable database or a missing table is a
 * note, not an exit code, so the server still comes up and reports its own
 * errors.
 */
import { readFileSync } from "node:fs";
import { pendingMigrations, type JournalEntry } from "./pending-migrations";
import { scriptPgClient } from "./script-database-url";
import { log } from "@/packages/log";

const journal: JournalEntry[] = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/core/db/migrations/meta/_journal.json",
      import.meta.url
    ),
    "utf-8"
  )
).entries;

const { client, host } = scriptPgClient({
  config: { connectionTimeoutMillis: 5000 },
});

try {
  await client.connect();
  const result = await client.query<{ max: string | null }>(
    'SELECT max(created_at)::text AS max FROM "drizzle"."__drizzle_migrations"'
  );
  const pending = pendingMigrations(journal, Number(result.rows[0]?.max ?? 0));
  if (pending.length > 0) {
    log.warn(
      [
        "",
        "!".repeat(72),
        `!! ${host} is BEHIND this checkout by ${pending.length} migration(s):`,
        ...pending.map((tag) => `!!   ${tag}`),
        "!! Pages that read the new schema will fail until it is applied.",
        "!! From the main checkout:",
        "!!   git switch main && git pull --ff-only && pnpm db:migrate",
        "!".repeat(72),
        "",
      ].join("\n")
    );
  } else {
    log.info(`Migrations: ${host} is up to date with this checkout.`);
  }
} catch (error) {
  log.warn(
    `Migrations: could not check ${host} (${(error as Error).message}); starting anyway.`
  );
} finally {
  await client.end().catch(() => {});
}
