// The Vercel build's migrate step (#2655): merging a migration to `main` runs
// it. A production build with a pending migration backs production up on
// PlanetScale, waits for the backup, prints its ID, then migrates, under a
// Postgres advisory lock. Every build, preview included, then fails unless
// production has this commit's latest migration, so the previous deployment
// keeps serving. The logic and its tests are in @cvm/core/db/migrate-on-deploy;
// this file only reads the env, builds the clients and runs Drizzle's migrator.
//
// Runs after `assert-production-source.mjs` (a production build is GitHub's
// `main`, cloned) and after `@cvm/core` is built, whose dist/ it imports.
//
// Env (Production only; Matt sets them, agents never do):
//   DATABASE_URL              pooled; already set. Read only.
//   DIRECT_DATABASE_URL       the primary; needed only when a migration is pending.
//   PLANETSCALE_BACKUP_TOKEN  `<SERVICE_TOKEN_ID>:<SERVICE_TOKEN>`, read_backups +
//                             write_backups; needed only when a migration is pending.
// No value is ever printed.
//
// Plain .mjs so it runs on whatever Node the build image has, with no
// TypeScript step. Not imported by the app, so Vercel never ships it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { migrateOnDeploy } from "@cvm/core/db/migrate-on-deploy";
import {
  PLANETSCALE_API,
  PRODUCTION_TARGET,
} from "@cvm/core/db/planetscale-backup";

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/core/db/migrations", import.meta.url)
);
const journal = JSON.parse(
  readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf-8")
).entries;

const fail = (message) => {
  console.error(`\nmigrate-on-deploy: ${message}\n`);
  process.exit(1);
};

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
if (!pooledUrl) fail("DATABASE_URL is not set in the build environment.");

const pooled = new pg.Pool({ connectionString: pooledUrl, max: 1 });
const direct = directUrl
  ? new pg.Pool({ connectionString: directUrl, max: 2 })
  : undefined;
for (const pool of [pooled, direct]) pool?.on("error", () => {});

try {
  await migrateOnDeploy({
    vercelEnv: process.env.VERCEL_ENV,
    journal,
    pooled,
    direct,
    applyMigrations: () => migrate(drizzle(direct), { migrationsFolder }),
    backupToken: process.env.PLANETSCALE_BACKUP_TOKEN,
    planetscale: {
      apiBase: PLANETSCALE_API,
      target: PRODUCTION_TARGET,
      pollIntervalMs: 10_000,
      // Inside Vercel's 45-minute build limit.
      timeoutMs: 30 * 60_000,
    },
    log: (line) => console.log(line),
  });
} catch (error) {
  await Promise.all([pooled.end(), direct?.end()]).catch(() => {});
  fail(error instanceof Error ? error.message : String(error));
}
await Promise.all([pooled.end(), direct?.end()]).catch(() => {});
