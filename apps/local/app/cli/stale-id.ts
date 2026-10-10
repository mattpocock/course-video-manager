import { Effect } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { NotFoundError, notFound } from "./errors";
import { CliOutput } from "./output";

/**
 * Why an id is missing, when the answer is "it belonged to an older Course
 * Version": the Draft's equivalent id and a sentence saying so.
 */
export interface StaleIdExplanation {
  readonly currentId: string;
  readonly message: string;
}

/**
 * Explain a Section or Lesson id that no longer resolves, if it was one of an
 * older Course Version's.
 *
 * Every Submit copies the Draft into a fresh Draft with fresh ids, and a
 * Discarded Pending Version takes its ids with it — so an id an agent read
 * before a Submit can stop resolving while its content lives on. A bare
 * NotFoundError there reads as "deleted"; this names the id to retry with.
 *
 * Best effort: a failed lookup leaves the plain NotFoundError, never a worse
 * error. Resolves undefined when nothing descends from `id`.
 */
export const explainStaleId =
  (entity: "section" | "lesson") =>
  (
    id: string
  ): Effect.Effect<
    StaleIdExplanation | undefined,
    never,
    VersionOperationsService
  > =>
    Effect.flatMap(VersionOperationsService, (svc) =>
      svc.findVersionSuccessor(entity, id)
    ).pipe(
      Effect.map((successor) => {
        if (successor === null) return undefined;
        const where =
          successor.commitState === "draft"
            ? `its equivalent in the current Draft is ${successor.id}`
            : `its latest copy is ${successor.id}, in a ${successor.commitState} version (the Draft has no copy of it)`;
        const archived = successor.archived ? ` (archived there)` : "";
        return {
          currentId: successor.id,
          message: `${entity} ${id} belongs to an older Course Version that no longer exists; ${where}${archived}`,
        };
      }),
      Effect.orElseSucceed(() => undefined)
    );

/**
 * Fail with the CLI NotFoundError for `id`, carrying the Draft's equivalent id
 * when `id` belonged to an older Course Version (see {@link explainStaleId}).
 * The drop-in for `notFound(entity, id)` on a Section's or Lesson's own id.
 */
export const notFoundOrStale = (
  entity: "section" | "lesson",
  id: string
): Effect.Effect<never, NotFoundError, VersionOperationsService> =>
  Effect.flatMap(explainStaleId(entity)(id), (why) =>
    Effect.fail(
      why === undefined
        ? notFound(entity, id)
        : new NotFoundError({ entity, id, ...why })
    )
  );

/** The nouns whose ids change with every Course Version. */
export type DraftEntity = "section" | "lesson" | "video";

/**
 * Resolve a Section, Lesson or Video reference to its id in the current Draft
 * — THE step every such CLI argument goes through (see `draftIdArg` in
 * ./entity-id.ts), so no command can act on a stale id by accident.
 *
 * - A current id passes through untouched.
 * - A stable `lineageId` resolves silently: it is the id callers are told to
 *   store, so resolving it is the normal case.
 * - An id from an older Course Version resolves to the Draft's row of the same
 *   lineage, with a one-line note on STDERR naming the id it resolved to.
 * - A reference whose lineage has no row in the Draft fails NotFound, naming
 *   its latest copy.
 * - An unknown reference is passed through, so each command keeps its own
 *   not-found handling. So is any failure of the lookup itself: resolving is
 *   best effort and never turns a working id into an error.
 */
export const resolveDraftId = (
  entity: DraftEntity,
  ref: string
): Effect.Effect<string, NotFoundError, VersionOperationsService | CliOutput> =>
  Effect.flatMap(VersionOperationsService, (svc) =>
    svc.resolveEntityRef(entity, ref)
  ).pipe(
    Effect.orElseSucceed(() => ({ kind: "unknown" }) as const),
    Effect.flatMap((r) => {
      if (r.kind === "unknown") return Effect.succeed(ref);
      if (r.kind === "noDraftCopy") {
        const { latest } = r;
        const where =
          latest.commitState === "draft"
            ? `its copy in the current Draft is ${latest.id}${latest.archived ? " (archived)" : ""}`
            : `the current Draft has no copy of it; ${latest.id === ref ? "it lives only" : `its latest copy is ${latest.id},`} in a ${latest.commitState} version${latest.archived ? " (archived there)" : ""}`;
        return Effect.fail(
          new NotFoundError({
            entity,
            id: ref,
            message: `${entity} ${ref} belongs to an older Course Version; ${where}`,
            ...(latest.commitState === "draft" ? { currentId: latest.id } : {}),
          })
        );
      }
      // An archived Draft row still resolves: `unarchive` needs it, and every
      // other verb already reports an archived row as not-found.
      if (r.via === "id") return Effect.succeed(r.id);
      if (r.via === "lineage") return Effect.succeed(r.id);
      return Effect.as(
        Effect.flatMap(CliOutput, (out) =>
          out.stderr(
            `note: ${entity} ${ref} is from an older Course Version; resolved to ${r.id} in the current Draft (store its stable lineageId ${r.lineageId} instead)\n`
          )
        ),
        r.id
      );
    })
  );
