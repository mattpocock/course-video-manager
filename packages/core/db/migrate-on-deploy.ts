/**
 * The `apps/remote` build's migrate step (#2655). Merging a migration to
 * `main` runs it: the production build backs production up, waits for the
 * backup, prints its ID, then migrates — the same `backupThenMigrate` as the
 * break-glass `pnpm db:migrate:prod` (#2653).
 *
 * 1. Read how far production is (one SELECT on the pooled `DATABASE_URL`).
 * 2. A preview build never migrates. Nothing pending: no backup, no direct
 *    connection, done.
 * 3. Otherwise, on the direct connection, take a Postgres advisory lock so
 *    two concurrent builds cannot both migrate, and re-check: the build that
 *    waited finds nothing pending and does nothing.
 * 4. Backup, wait for `success`, print the ID, migrate.
 * 5. Every build, preview or not, then fails unless production has this
 *    commit's latest migration, so a deploy that would read schema production
 *    lacks is never promoted (PR #1859).
 *
 * Any failure throws, which fails the build, so the previous deployment keeps
 * serving. No DB URL or token value ever reaches a log line or an error.
 *
 * Kept free of `fs` and of client construction: the build's plain-JS wrapper
 * (`apps/remote/scripts/migrate-on-deploy.mjs`) reads the env and the journal,
 * builds the clients and runs Drizzle's migrator.
 */
import {
  backupThenMigrate,
  parseServiceToken,
  type PlanetScaleTarget,
} from "./planetscale-backup.js";

export interface JournalEntry {
  readonly tag: string;
  readonly when: number;
}

/** What a `pg.Pool`, a `pg.Client` and a `pg.PoolClient` all have. */
export interface SqlSession {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** A `pg.Pool` on `DIRECT_DATABASE_URL`: one session, held for the lock. */
export interface DirectConnection {
  connect(): Promise<SqlSession & { release(): void }>;
}

export interface MigrateOnDeployOptions {
  /** `VERCEL_ENV`. Only `production` migrates. */
  readonly vercelEnv: string | undefined;
  /** This commit's `meta/_journal.json` entries, oldest first. */
  readonly journal: readonly JournalEntry[];
  /** The pooled `DATABASE_URL` the app runs on. Read only. */
  readonly pooled: SqlSession;
  /** `DIRECT_DATABASE_URL`, or undefined when it is not set. */
  readonly direct: DirectConnection | undefined;
  /** Drizzle's migrator over the direct connection. */
  readonly applyMigrations: () => Promise<unknown>;
  /** `PLANETSCALE_BACKUP_TOKEN` as set, or undefined. */
  readonly backupToken: string | undefined;
  readonly planetscale: {
    readonly apiBase: string;
    readonly target: PlanetScaleTarget;
    readonly pollIntervalMs: number;
    readonly timeoutMs: number;
  };
  readonly now?: () => Date;
  readonly log: (line: string) => void;
}

export type MigrateOnDeployOutcome =
  | { readonly kind: "up-to-date"; readonly latest: string }
  | {
      readonly kind: "migrated";
      readonly latest: string;
      readonly applied: readonly string[];
      readonly backupId: string;
    };

export class MigrateOnDeployError extends Error {
  override readonly name = "MigrateOnDeployError";
}

/**
 * One fixed key for every caller that migrates production. Arbitrary, but
 * never change it: two builds on different keys would not exclude each other.
 */
export const MIGRATION_LOCK_KEY = "7262201126550001";

const appliedUpTo = async (session: SqlSession): Promise<number> => {
  try {
    // Drizzle's migrator records each migration's journal `when` as
    // created_at and applies only migrations newer than the newest recorded.
    const { rows } = await session.query(
      'SELECT max(created_at)::text AS max FROM "drizzle"."__drizzle_migrations"'
    );
    return Number((rows[0] as { max: string | null } | undefined)?.max ?? 0);
  } catch (error) {
    throw new MigrateOnDeployError(
      `could not read the migrations table: ${(error as Error).message}`
    );
  }
};

const pendingAfter = (
  journal: readonly JournalEntry[],
  upTo: number
): string[] => journal.filter((e) => e.when > upTo).map((e) => e.tag);

export const migrateOnDeploy = async (
  opts: MigrateOnDeployOptions
): Promise<MigrateOnDeployOutcome> => {
  const latest = opts.journal.at(-1);
  if (!latest) throw new MigrateOnDeployError("the journal has no entries.");

  const assertApplied = async () => {
    if ((await appliedUpTo(opts.pooled)) < latest.when) {
      throw new MigrateOnDeployError(
        [
          `production has not applied ${latest.tag}, which this commit's code expects.`,
          "Refusing to deploy code that would query schema that does not exist yet.",
        ].join("\n")
      );
    }
  };

  const pending = pendingAfter(opts.journal, await appliedUpTo(opts.pooled));
  if (opts.vercelEnv !== "production" || pending.length === 0) {
    if (opts.vercelEnv !== "production") {
      opts.log(
        `Not a production build (VERCEL_ENV=${opts.vercelEnv ?? "unset"}): never migrates.`
      );
    } else {
      opts.log(`No migration pending: production is at ${latest.tag}.`);
    }
    await assertApplied();
    return { kind: "up-to-date", latest: latest.tag };
  }

  // Pending: everything below needs the direct URL and the token. Check both
  // before anything connects or any backup is taken.
  if (!opts.direct) {
    throw new MigrateOnDeployError(
      `${pending.join(", ")} pending, but DIRECT_DATABASE_URL is not set in this build. Matt adds it to the Vercel project (Production). Nothing was migrated.`
    );
  }
  if (!opts.backupToken) {
    throw new MigrateOnDeployError(
      `${pending.join(", ")} pending, but PLANETSCALE_BACKUP_TOKEN is not set in this build. Matt adds it to the Vercel project (Production). Nothing was migrated.`
    );
  }
  const authorization = parseServiceToken(
    opts.backupToken,
    "PLANETSCALE_BACKUP_TOKEN"
  );

  const session = await opts.direct.connect();
  let outcome: MigrateOnDeployOutcome;
  try {
    const { rows } = await session.query(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [MIGRATION_LOCK_KEY]
    );
    if (!(rows[0] as { locked: boolean } | undefined)?.locked) {
      opts.log("Another build holds the migration lock. Waiting for it…");
      await session.query("SELECT pg_advisory_lock($1::bigint)", [
        MIGRATION_LOCK_KEY,
      ]);
    }
    try {
      outcome = await migrateUnderLock(opts, session, authorization, latest);
    } finally {
      await session
        .query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY])
        .catch(() => {});
    }
  } finally {
    session.release();
  }
  await assertApplied();
  return outcome;
};

const migrateUnderLock = async (
  opts: MigrateOnDeployOptions,
  session: SqlSession,
  authorization: string,
  latest: JournalEntry
): Promise<MigrateOnDeployOutcome> => {
  // Re-read under the lock: a build that waited finds the work done.
  const pending = pendingAfter(opts.journal, await appliedUpTo(session));
  if (pending.length === 0) {
    opts.log(
      `Another build already migrated production to ${latest.tag}. No backup taken.`
    );
    return { kind: "up-to-date", latest: latest.tag };
  }
  opts.log(`Pending: ${pending.join(", ")}.`);

  const stamp = (opts.now?.() ?? new Date())
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 15);
  const { backupId } = await backupThenMigrate({
    apiBase: opts.planetscale.apiBase,
    authorization,
    target: opts.planetscale.target,
    backupName: `pre-migrate-${latest.tag}-${stamp}z`.toLowerCase(),
    retentionDays: 30,
    pollIntervalMs: opts.planetscale.pollIntervalMs,
    timeoutMs: opts.planetscale.timeoutMs,
    log: opts.log,
    migrate: async () => {
      await opts.applyMigrations();
    },
  });

  if ((await appliedUpTo(session)) < latest.when) {
    throw new MigrateOnDeployError(
      `the migrator finished but production is still not at ${latest.tag}. The backup ${backupId} is intact.`
    );
  }
  opts.log(`Migrated to ${latest.tag}. Pre-migration backup: ${backupId}`);
  return { kind: "migrated", latest: latest.tag, applied: pending, backupId };
};
