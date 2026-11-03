/**
 * Postgres's answer when a query names a table or column the database does
 * not have: `undefined_table` and `undefined_column`. Against the author's
 * database that means it is BEHIND this checkout — a migration that adds the
 * table or column has not been applied (production is migrated by hand,
 * ADR 0026) — not a bug in the page.
 */
const SCHEMA_BEHIND_CODES = new Set(["42P01", "42703"]);

/** The command that applies the pending migrations, run from the main checkout. */
export const MIGRATE_COMMAND =
  "git switch main && git pull --ff-only && pnpm db:migrate";

const MAX_CAUSE_DEPTH = 10;

/**
 * The message a route answers with when `error`, or anything on its `cause`
 * chain, is Postgres saying a table or column is missing; else `undefined`.
 * It quotes Postgres (which table) and says how to migrate.
 */
export const schemaBehindMessageOf = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current === null || typeof current !== "object") return undefined;
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof code === "string" && SCHEMA_BEHIND_CODES.has(code)) {
      const detail = typeof message === "string" ? `: ${message}` : "";
      return `The database is behind this checkout${detail}. Apply the pending migrations from the main checkout: ${MIGRATE_COMMAND}`;
    }
    current = cause;
  }
  return undefined;
};
