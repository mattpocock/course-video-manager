import { type Database } from "./drizzle-service.server";
import { courseVersions } from "../db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
  VersionNotPendingError,
} from "./db-service-errors";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/**
 * The Pending-side lifecycle verbs (issues #1348/#1401), split out of
 * db-version-operations.server.ts for the repo's per-file token budget (same
 * pattern as db-video-operations.write.server.ts). Spread into
 * VersionOperationsService's returned object, so callers see them as ordinary
 * service methods. Submit lives in db-version-mutation.server.ts (it wraps the
 * clone transaction); these are its two exits plus the commitState readers.
 */
export const createVersionLifecycleOps = (db: Database) => {
  const getVersionRow = Effect.fn("getVersionRow")(function* (
    versionId: string
  ) {
    const version = yield* makeDbCall(() =>
      db.query.courseVersions.findFirst({
        where: eq(courseVersions.id, versionId),
      })
    );
    if (!version) {
      return yield* new NotFoundError({
        type: "getVersionRow",
        params: { versionId },
      });
    }
    return version;
  });

  /**
   * Promote (issue #1348): the Pending → Published transition, recorded after
   * the Dropbox `course.json` atomic rename (the external commit receipt)
   * lands. Acts only on a Pending row; anything else is a lifecycle bug.
   */
  const promotePendingVersion = Effect.fn("promotePendingVersion")(function* (
    versionId: string
  ) {
    const [promoted] = yield* makeDbCall(() =>
      db
        .update(courseVersions)
        .set({ commitState: "published" })
        .where(
          and(
            eq(courseVersions.id, versionId),
            eq(courseVersions.commitState, "pending")
          )
        )
        .returning()
    );

    if (!promoted) {
      const version = yield* getVersionRow(versionId);
      return yield* new VersionNotPendingError({
        versionId,
        commitState: version.commitState,
      });
    }

    return promoted;
  });

  /**
   * Discard (issues #1348/#1401): delete a Pending Version whose Commit did
   * not land. Deletes ONLY a `pending` row — a Draft or Published Version can
   * never be discarded — and cascades to its cloned sections/lessons/videos.
   * No content is lost: Submit already cloned the same structure into the new
   * Draft.
   */
  const discardPendingVersion = Effect.fn("discardPendingVersion")(function* (
    versionId: string
  ) {
    const version = yield* getVersionRow(versionId);
    if (version.commitState !== "pending") {
      return yield* new VersionNotPendingError({
        versionId,
        commitState: version.commitState,
      });
    }

    yield* makeDbCall(() =>
      db.delete(courseVersions).where(
        and(
          eq(courseVersions.id, versionId),
          // Re-assert pending inside the DELETE itself so a concurrent
          // Promote can never race this into deleting a Published row.
          eq(courseVersions.commitState, "pending")
        )
      )
    );

    return version;
  });

  /** The newest Published Version of a course, by commit state — not position. */
  const getLatestPublishedVersion = Effect.fn("getLatestPublishedVersion")(
    function* (repoId: string) {
      return yield* makeDbCall(() =>
        db.query.courseVersions.findFirst({
          where: and(
            eq(courseVersions.repoId, repoId),
            eq(courseVersions.commitState, "published")
          ),
          orderBy: desc(courseVersions.createdAt),
        })
      );
    }
  );

  /** The course's Pending Version, if one exists (at most one per course). */
  const getPendingVersion = Effect.fn("getPendingVersion")(function* (
    repoId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.courseVersions.findFirst({
        where: and(
          eq(courseVersions.repoId, repoId),
          eq(courseVersions.commitState, "pending")
        ),
      })
    );
  });

  return {
    promotePendingVersion,
    discardPendingVersion,
    getLatestPublishedVersion,
    getPendingVersion,
  };
};
