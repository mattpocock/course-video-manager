/**
 * `pnpm db:migrate:prod`: back production up on PlanetScale, wait for the
 * backup, print its ID, then run `pnpm db:migrate`. The only way an agent
 * migrates production (the `deploy-migration` skill, #2653).
 *
 * Before the backup it checks everything the migrate itself would refuse —
 * a local target, a git worktree, anything but a clean `main` at
 * `origin/main` — so a run that cannot migrate leaves no pointless backup.
 * `drizzle-kit migrate` checks the same rules again on its own.
 *
 * No flags. No fallback, no skip: no backup, no migrate.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalHost, parseHost } from "@cvm/core/db/connection-guard";
import {
  formatRefusal,
  judgeSchemaWrite,
  readGitState,
} from "@cvm/core/drizzle-guard";
import {
  BackupFirstMigrateError,
  PLANETSCALE_API,
  backupThenMigrate,
  type PlanetScaleTarget,
} from "./planetscale-backup";
import { scriptDatabaseUrl } from "./script-database-url";
import target from "./planetscale-target.json" with { type: "json" };

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url))
);
const TOKEN_PATH = path.join(
  os.homedir(),
  ".config/cvm/planetscale-backup-token"
);
const JOURNAL = path.join(
  REPO_ROOT,
  "packages/core/db/migrations/meta/_journal.json"
);

const fail = (message: string): never => {
  console.error(`\n${message}\n\nNothing was migrated.`);
  process.exit(1);
};

const preflight = (): void => {
  const { url } = scriptDatabaseUrl({ direct: true });
  const host = parseHost(url);
  if (host !== undefined && isLocalHost(host)) {
    fail(
      "db:migrate:prod migrates production, but DIRECT_DATABASE_URL points at a local database. Use `pnpm db:migrate` for that."
    );
  }
  const verdict = judgeSchemaWrite({
    url,
    readGit: () => readGitState(REPO_ROOT),
  });
  if (!verdict.allowed) fail(formatRefusal(verdict));
};

const latestTag = (): string => {
  const journal = JSON.parse(fs.readFileSync(JOURNAL, "utf8")) as {
    entries: { tag: string }[];
  };
  return journal.entries.at(-1)?.tag ?? "none";
};

class MigrateFailedError extends Error {
  override readonly name = "MigrateFailedError";
}

const migrate = async (): Promise<void> => {
  const result = spawnSync("pnpm", ["db:migrate"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new MigrateFailedError(
      `pnpm db:migrate exited with ${result.status ?? result.signal}. The backup above is intact.`
    );
  }
};

preflight();
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
try {
  const { backupId } = await backupThenMigrate({
    apiBase: PLANETSCALE_API,
    tokenPath: TOKEN_PATH,
    target: target satisfies PlanetScaleTarget,
    backupName: `pre-migrate-${latestTag()}-${stamp}z`.toLowerCase(),
    retentionDays: 30,
    pollIntervalMs: 10_000,
    timeoutMs: 30 * 60_000,
    log: (line) => console.log(line),
    migrate,
  });
  console.log(`\nMigrated. Pre-migration backup: ${backupId}`);
} catch (error) {
  if (error instanceof BackupFirstMigrateError) fail(error.message);
  if (error instanceof MigrateFailedError) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
  throw error;
}
