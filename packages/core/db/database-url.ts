/**
 * The domain database is hosted (PlanetScale Postgres), and a hosted Postgres
 * hands out two connection strings, not one:
 *
 * - `DATABASE_URL` — through the pooler (PgBouncer in transaction mode). Every
 *   application query goes here.
 * - `DIRECT_DATABASE_URL` — straight to the primary. Migrations go here,
 *   because a transaction-mode pooler cannot carry session-level DDL state
 *   (advisory locks, `SET` outliving a statement, prepared statements).
 *
 * A local Postgres container has no such split, so the direct string is
 * optional and falls back to the pooled one. That fallback is what keeps
 * "switching back is one environment variable" true.
 */
export interface DatabaseUrlEnv {
  readonly DATABASE_URL?: string | undefined;
  readonly DIRECT_DATABASE_URL?: string | undefined;
}

/** The pooled connection string the application runs its queries through. */
export const resolveDatabaseUrl = (
  env: DatabaseUrlEnv = process.env
): string | undefined => env.DATABASE_URL || undefined;

/** The connection string migrations run through — direct if one is configured. */
export const resolveMigrationDatabaseUrl = (
  env: DatabaseUrlEnv = process.env
): string | undefined =>
  env.DIRECT_DATABASE_URL || env.DATABASE_URL || undefined;
