import { type Database } from "./drizzle-service.server.js";
import { courseVersions, lessons, sections, videos } from "../db/schema.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { type VersionSuccessor } from "./db-version-successor.server.js";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { type AnyPgColumn } from "drizzle-orm/pg-core";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/** The version-scoped nouns whose ids change with every Course Version. */
export type RefEntity = "section" | "lesson" | "video";

/**
 * What a reference — an id from any Course Version, or the entity's stable
 * `lineageId` — names in its course's current Draft.
 *
 * - `draft`: the Draft's row. `via` says how it was reached: `id` (the
 *   reference already was a current id), `lineage` (it was the `lineageId`)
 *   or `stale` (it was an id from an older Course Version). `archived` is the
 *   Draft row's own state.
 * - `noDraftCopy`: the reference is real, but the Draft has nothing of its
 *   lineage. `latest` is the furthest copy that does exist.
 * - `unknown`: nothing was ever called that.
 */
export type EntityRefResolution =
  | {
      readonly kind: "draft";
      readonly id: string;
      readonly lineageId: string;
      readonly archived: boolean;
      readonly via: "id" | "lineage" | "stale";
    }
  | { readonly kind: "noDraftCopy"; readonly latest: VersionSuccessor }
  | { readonly kind: "unknown" };

interface Row {
  readonly id: string;
  readonly lineageId: string;
  readonly versionId: string | null;
  readonly repoId: string | null;
  /** Null only for a Standalone Video, which no Course Version owns. */
  readonly commitState: string | null;
  readonly archived: boolean;
}

/**
 * THE resolver for a Section, Lesson or Video reference. Every Submit copies
 * the Draft into a fresh Draft with fresh ids, so a stored id goes stale with
 * every Course Version. Each copy carries its `lineageId` unchanged, so the
 * lineage is what names "the same thing" across Versions and Drafts:
 *
 * 1. An id that still exists resolves to the Draft's row of the same lineage
 *    in the same course (itself, when it is already in the Draft).
 * 2. A `lineageId` resolves to the Draft's row of that lineage.
 * 3. A Section or Lesson id whose row is gone (its Pending Version was
 *    Discarded) is followed forward through its `previousVersion…Id` links
 *    (`findVersionSuccessor`). Videos keep no such link.
 *
 * A Standalone Video belongs to no Course Version, so its id never goes stale.
 */
export const createEntityRefOps = (
  db: Database,
  findVersionSuccessor: (
    entity: "section" | "lesson",
    id: string
  ) => Effect.Effect<VersionSuccessor | null, UnknownDBServiceError>
) => {
  type Where = (t: {
    readonly id: AnyPgColumn;
    readonly lineageId: AnyPgColumn;
  }) => SQL | undefined;

  const version = {
    versionId: courseVersions.id,
    repoId: courseVersions.repoId,
    commitState: courseVersions.commitState,
  };

  const findRow = (
    entity: RefEntity,
    where: Where,
    draftOnly: { repoId?: string } | undefined
  ): Effect.Effect<Row | undefined, UnknownDBServiceError> => {
    const scope = (extra: SQL | undefined) =>
      draftOnly === undefined
        ? extra
        : and(
            extra,
            // A Standalone Video has no version, and is always current.
            entity === "video" && draftOnly.repoId === undefined
              ? or(
                  eq(courseVersions.commitState, "draft"),
                  isNull(courseVersions.id)
                )
              : eq(courseVersions.commitState, "draft"),
            draftOnly.repoId === undefined
              ? undefined
              : eq(courseVersions.repoId, draftOnly.repoId)
          );
    return makeDbCall(async (): Promise<Row | undefined> => {
      if (entity === "section") {
        const [row] = await db
          .select({
            id: sections.id,
            lineageId: sections.lineageId,
            archivedAt: sections.archivedAt,
            ...version,
          })
          .from(sections)
          .innerJoin(
            courseVersions,
            eq(sections.repoVersionId, courseVersions.id)
          )
          .where(scope(where(sections)))
          .limit(1);
        if (!row) return undefined;
        const { archivedAt, ...rest } = row;
        return { ...rest, archived: archivedAt !== null };
      }
      if (entity === "lesson") {
        const [row] = await db
          .select({
            id: lessons.id,
            lineageId: lessons.lineageId,
            archived: lessons.archived,
            ...version,
          })
          .from(lessons)
          .innerJoin(sections, eq(lessons.sectionId, sections.id))
          .innerJoin(
            courseVersions,
            eq(sections.repoVersionId, courseVersions.id)
          )
          .where(scope(where(lessons)))
          .limit(1);
        return row;
      }
      const [row] = await db
        .select({
          id: videos.id,
          lineageId: videos.lineageId,
          archived: videos.archived,
          ...version,
        })
        .from(videos)
        .leftJoin(lessons, eq(videos.lessonId, lessons.id))
        .leftJoin(sections, eq(lessons.sectionId, sections.id))
        .leftJoin(courseVersions, eq(sections.repoVersionId, courseVersions.id))
        .where(scope(where(videos)))
        .limit(1);
      return row;
    });
  };

  const inDraft = (
    row: Row,
    via: "id" | "lineage" | "stale"
  ): EntityRefResolution => ({
    kind: "draft",
    id: row.id,
    lineageId: row.lineageId,
    archived: row.archived,
    via,
  });

  const latestOf = (row: Row): EntityRefResolution => ({
    kind: "noDraftCopy",
    latest: {
      id: row.id,
      versionId: row.versionId ?? "",
      commitState: row.commitState ?? "draft",
      archived: row.archived,
    },
  });

  /** Last resort for a reference no lineage reaches: the forward chain. */
  const viaSuccessor = (entity: RefEntity, ref: string) =>
    Effect.gen(function* () {
      if (entity === "video") return null;
      const successor = yield* findVersionSuccessor(entity, ref);
      if (successor === null) return null;
      if (successor.commitState === "draft") {
        const row = yield* findRow(entity, (t) => eq(t.id, successor.id), {});
        if (row !== undefined) return inDraft(row, "stale");
      }
      const result: EntityRefResolution = {
        kind: "noDraftCopy",
        latest: successor,
      };
      return result;
    });

  const resolveEntityRef = Effect.fn("resolveEntityRef")(function* (
    entity: RefEntity,
    ref: string
  ) {
    const own = yield* findRow(entity, (t) => eq(t.id, ref), undefined);
    if (own !== undefined) {
      // In the Draft already, or a Standalone Video (no version to go stale).
      if (own.commitState === "draft" || own.commitState === null) {
        return inDraft(own, "id");
      }
      const copy = yield* findRow(
        entity,
        (t) => eq(t.lineageId, own.lineageId),
        { repoId: own.repoId ?? undefined }
      );
      if (copy !== undefined) return inDraft(copy, "stale");
      const chained = yield* viaSuccessor(entity, ref);
      return chained?.kind === "draft" ? chained : (chained ?? latestOf(own));
    }

    const byLineage = yield* findRow(entity, (t) => eq(t.lineageId, ref), {});
    if (byLineage !== undefined) return inDraft(byLineage, "lineage");

    const chained = yield* viaSuccessor(entity, ref);
    if (chained !== null) return chained;

    // A lineage whose rows all live in older Versions.
    const anyOfLineage = yield* findRow(
      entity,
      (t) => eq(t.lineageId, ref),
      undefined
    );
    const result: EntityRefResolution =
      anyOfLineage === undefined ? { kind: "unknown" } : latestOf(anyOfLineage);
    return result;
  });

  return { resolveEntityRef };
};
