/**
 * The connection string for a one-off DB script under `apps/local/scripts/`.
 *
 * Every such script needs the same three things, so get them here rather than
 * re-deriving them per script:
 *
 * 1. **The env.** Load the repo-root `.env` exactly as
 *    `packages/core/drizzle.config.ts` does (`process.loadEnvFile`), so a
 *    script runs from a plain checkout the same way `pnpm db:migrate` does.
 *    A missing file is fine — a real environment supplies the variables — and
 *    `loadEnvFile` never overrides a variable already set, so
 *    `DATABASE_URL=… pnpm --filter @cvm/local db:…` still points a run at a
 *    local clone.
 * 2. **The URL.** Pooled by default; `direct: true` for anything touching
 *    schema or migration bookkeeping (see `@cvm/core/db/database-url`).
 * 3. **The target, announced.** Prints the host — never the credentials — so
 *    the operator sees which database is about to be read or written.
 * 4. **The target, guarded.** From a git worktree, a writable connection to a
 *    remote database is refused before it is opened — see
 *    `@cvm/core/db/connection-guard`.
 *
 * Build the client here too — `scriptPgClient()` or `scriptDrizzle()` — never
 * with `new Client`/`new Pool` in the script: the lint rule local/db-clients
 * allows client construction only in the guarded factories.
 */
import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client, Pool, type ClientConfig } from "pg";
import * as schema from "@cvm/core/db/schema";
import {
  resolveDatabaseUrl,
  resolveMigrationDatabaseUrl,
} from "@cvm/core/db/database-url";
import {
  formatConnectionRefusal,
  judgeConnection,
} from "@cvm/core/db/connection-guard";
import { isInsideGitWorktree } from "@cvm/core/git-worktree";

export interface ScriptDatabase {
  readonly url: string;
  /** `host:port` only — safe to print. */
  readonly host: string;
}

export const scriptDatabaseUrl = (
  opts: { readonly direct?: boolean } = {}
): ScriptDatabase => {
  try {
    process.loadEnvFile(
      fileURLToPath(new URL("../../../.env", import.meta.url))
    );
  } catch {
    // No .env — the environment supplies the variables directly.
  }

  const url = opts.direct
    ? resolveMigrationDatabaseUrl()
    : resolveDatabaseUrl();
  if (!url) {
    console.error(
      "DATABASE_URL is not set (checked the environment and the repo-root .env)"
    );
    process.exit(1);
  }

  const host = new URL(url).host;
  console.log(`Target database: ${host}`);

  const verdict = judgeConnection({
    url,
    env: process.env,
    insideGitWorktree: () => isInsideGitWorktree(),
  });
  if (!verdict.allowed) {
    console.error(`\n${formatConnectionRefusal(verdict)}\n`);
    process.exit(1);
  }
  return { url, host };
};

/**
 * A `pg` Client on the guarded connection string. Not yet connected — call
 * `client.connect()` and `client.end()` as before. `config` takes any other
 * client option (a timeout, say); the connection string is not one of them.
 */
export const scriptPgClient = (
  opts: {
    readonly direct?: boolean;
    readonly config?: Omit<ClientConfig, "connectionString">;
  } = {}
): ScriptDatabase & { readonly client: Client } => {
  const target = scriptDatabaseUrl({ direct: opts.direct });
  return {
    ...target,
    client: new Client({ ...opts.config, connectionString: target.url }),
  };
};

/** A Drizzle database over a pooled connection on the guarded connection string. */
export const scriptDrizzle = (
  opts: { readonly direct?: boolean } = {}
): ScriptDatabase & { readonly db: NodePgDatabase<typeof schema> } => {
  const target = scriptDatabaseUrl(opts);
  return {
    ...target,
    db: drizzle(new Pool({ connectionString: target.url }), { schema }),
  };
};
