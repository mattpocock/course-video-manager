import { courses, courseVersions } from "../db/schema";
import type { Database } from "./drizzle-service.server";
import {
  NotLatestVersionError,
  PendingVersionExistsError,
  UnknownDBServiceError,
  VersionNotDraftError,
} from "./db-service-errors";
import { requireDraftVersion } from "./draft-guard.server";
import { withDbTransaction } from "./with-db-transaction.server";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";

export type CopyVersionStructureInput = {
  sourceVersionId: string;
  repoId: string;
  newVersionName?: string;
};

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

export const lockCourseForVersionMutation = (
  transaction: Database,
  repoId: string
) =>
  makeDbCall(() =>
    transaction.execute(
      sql`select ${courses.id} from ${courses} where ${courses.id} = ${repoId} for update`
    )
  );

/**
 * Submit (issue #1348): the Draft → Pending transition. In one transaction it
 * clones the Draft's structure into a fresh Draft, then stamps the source with
 * its publish name/description and marks it `pending`. The Pending Version is
 * what Commit uploads; it is Promoted to `published` once the Dropbox
 * `course.json` rename (the commit receipt) lands, or Discarded on a caught
 * Commit failure (issue #1401).
 *
 * At most one Pending Version may exist per course — a leftover Pending (a
 * crash in the receipt→Promote gap) must be healed before another Submit.
 */
export const freezeAndCloneVersion = <A, E>(
  db: Database,
  input: CopyVersionStructureInput & {
    sourceName: string;
    sourceDescription: string;
  },
  copyVersionStructureInDb: (
    transaction: Database,
    input: CopyVersionStructureInput
  ) => Effect.Effect<A, E>
): Effect.Effect<
  A,
  | E
  | NotLatestVersionError
  | PendingVersionExistsError
  | VersionNotDraftError
  | UnknownDBServiceError
> =>
  withDbTransaction(db, (transaction) =>
    Effect.gen(function* () {
      yield* lockCourseForVersionMutation(transaction, input.repoId);
      // #1403: take the version-row lock that guarded writes contend on
      // BEFORE cloning. A write committing after this point blocks on the row
      // and re-reads commitState (→ VersionNotDraftError); one committing
      // before it is visible to the clone. No clip can straddle the freeze.
      yield* requireDraftVersion(transaction, input.sourceVersionId);
      const existingPending = yield* makeDbCall(() =>
        transaction.query.courseVersions.findFirst({
          where: and(
            eq(courseVersions.repoId, input.repoId),
            eq(courseVersions.commitState, "pending")
          ),
          columns: { id: true },
        })
      );
      if (existingPending) {
        return yield* new PendingVersionExistsError({
          repoId: input.repoId,
          pendingVersionId: existingPending.id,
        });
      }
      // Clone first (its own latest + draft checks run against the untouched
      // source), then stamp the source as the Pending Version.
      const result = yield* copyVersionStructureInDb(transaction, input);
      yield* makeDbCall(() =>
        transaction
          .update(courseVersions)
          .set({
            name: input.sourceName,
            description: input.sourceDescription,
            commitState: "pending",
          })
          .where(eq(courseVersions.id, input.sourceVersionId))
      );
      return result;
    })
  );
