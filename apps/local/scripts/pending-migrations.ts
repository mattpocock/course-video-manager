/**
 * Which of this checkout's migrations the database has not applied yet.
 *
 * Drizzle's migrator records each migration's journal `when` as `created_at`
 * in `drizzle.__drizzle_migrations`, and applies only the entries newer than
 * the newest one it has recorded — so "behind" is every journal entry whose
 * `when` is later than that maximum. Same rule as the `apps/remote` deploy
 * check (`@cvm/core/db/migrate-on-deploy`).
 */
export interface JournalEntry {
  readonly tag: string;
  readonly when: number;
}

export const pendingMigrations = (
  journal: readonly JournalEntry[],
  appliedUpTo: number
): string[] => journal.filter((e) => e.when > appliedUpTo).map((e) => e.tag);
