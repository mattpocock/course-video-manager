import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import pg, { Pool } from "pg";
import * as schema from "../db/schema.js";
import { resolveDatabaseUrl } from "../db/database-url.js";
import {
  formatConnectionRefusal,
  judgeConnection,
} from "../db/connection-guard.js";
import { sqlStatementLogger } from "../db/sql-statement-log.js";
import { makePatient, type DbPatience } from "../db/connection-patience.js";

export type { DbPatience };
import { countSqlStatement } from "../db/sql-statement-tally.js";
import { Context, Effect, Layer } from "effect";

export type DrizzleDB = NodePgDatabase<typeof schema>;

export type Database =
  | DrizzleDB
  | NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

/**
 * Whether this process runs from a linked git worktree — which `DrizzleService`
 * must know before it connects (see `../db/connection-guard.ts`). A required
 * dependency, not an optional one, so a layer that forgets to say fails to
 * build rather than connecting unguarded.
 *
 * `@cvm/core` cannot ask git itself, so the composition root provides it:
 * `GitWorktreeProbeLive` (`@cvm/core/git-worktree`) on the author's machine,
 * `GitWorktreeProbe.NoCheckout` on the deployed box, which has no git.
 */
export class GitWorktreeProbe extends Context.Tag("GitWorktreeProbe")<
  GitWorktreeProbe,
  { readonly insideGitWorktree: () => boolean }
>() {
  /** For a box with no git checkout (Vercel): never a worktree. */
  static readonly NoCheckout = Layer.succeed(GitWorktreeProbe, {
    insideGitWorktree: () => false,
  });
}

/**
 * The connection pool, with the error listeners `pg` requires. A pooled
 * connection the database drops while it sits idle (a restart, a network
 * blip, the pooler recycling it) makes the pool emit `error`; with no
 * listener that is an uncaught exception, and it killed the whole process —
 * the sidecar on any database outage, the app server too. The pool has
 * already dropped the dead connection; the next query opens a fresh one, and
 * fails as a query (a tagged error) while the database is still away.
 */
export const makeConnectionPool = (
  url: string,
  opts: {
    /**
     * For a caller that can wait: ride out a network drop (`DbPatience`,
     * #2621). Omitted, the pool fails on the first try, as interactive
     * callers want.
     */
    readonly patience?: DbPatience;
    /** The `pg` client class. A test passes one that fails on cue. */
    readonly Client?: typeof pg.Client;
  } = {}
): Pool => {
  const pool = new Pool({
    connectionString: url,
    ...(opts.Client ? { Client: opts.Client } : {}),
  });
  pool.on("error", (error) => {
    console.error(
      `[db] a pooled connection dropped (${error.message}); the next query opens a new one`
    );
  });
  // The pool's listener covers IDLE connections only: pg-pool takes its own
  // listener off a connection while it is checked out. One the database drops
  // then — between two statements of a transaction, say — emits `error` on
  // the Client with nobody listening, and that crashed the Sidecar twice after
  // the DNS blip of 2026-10-13 (exit 7, #2170). A listener on every
  // connection, for its whole life: the statement in flight still fails as a
  // query, and the pool throws the broken connection away when it is released.
  pool.on("connect", (client) => {
    client.on("error", (error) => {
      console.error(
        `[db] a connection in use dropped (${error.message}); its query fails and the pool replaces it`
      );
    });
  });
  return opts.patience ? makePatient(pool, opts.patience) : pool;
};

/** The guarded client: `patience` for a caller that can wait (#2621). */
const makeDrizzle = (patience?: DbPatience) =>
  Effect.gen(function* () {
    // The pooled connection string. Migrations use the direct one instead —
    // see @/db/database-url.
    const url = resolveDatabaseUrl();
    if (!url) {
      return yield* Effect.die(
        new Error("DATABASE_URL is not set in environment variables")
      );
    }
    // A worktree never opens a writable connection to a remote database.
    const probe = yield* GitWorktreeProbe;
    const verdict = judgeConnection({
      url,
      env: process.env,
      insideGitWorktree: probe.insideGitWorktree,
    });
    if (!verdict.allowed) {
      return yield* Effect.die(new Error(formatConnectionRefusal(verdict)));
    }
    const sqlLog = sqlStatementLogger();
    return drizzle(makeConnectionPool(url, { patience }), {
      schema,
      // Always on: the slow-request log's statement count rides on it.
      logger: {
        logQuery: (query, params) => {
          countSqlStatement();
          sqlLog?.logQuery(query, params);
        },
      },
    }) as DrizzleDB;
  });

export class DrizzleService extends Effect.Service<DrizzleService>()(
  "DrizzleService",
  { effect: makeDrizzle() }
) {
  /**
   * The same guarded client on a patient pool (`DbPatience`): for callers that
   * can wait out a network drop, the Sidecar's Jobs. Interactive callers
   * keep `Default`, which fails on the first try.
   */
  static readonly Patient = (patience: DbPatience) =>
    Layer.effect(
      DrizzleService,
      Effect.map(makeDrizzle(patience), DrizzleService.make)
    );
}
