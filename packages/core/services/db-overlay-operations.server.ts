import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clips, overlays } from "../db/schema.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
  requireDraftVersionForClip,
  requireDraftVersionForOverlay,
} from "./draft-guard.server.js";
import { transactionalizeWrites } from "./with-db-transaction.server.js";
import type { OverlayKind } from "../features/videos/overlay-kind.js";

/**
 * Overlays — the visual layers composited on top of a Video's footage, each
 * anchored to one Clip at a plain Clip-relative offset (see CONTEXT.md,
 * "Overlays and transitions", and the `overlays` table's own doc comment).
 *
 * Overlays are addressed by id and listed per Video, never per Course Version:
 * they hang off the live recorded timeline exactly as Clips do. Deletion is a
 * real DELETE — there is no archive and no restore.
 *
 * Absent rows are reported by RETURNING NOTHING (undefined / an empty array),
 * never by a domain NotFoundError: the CLI owns not-found detection, so a
 * `get` of a mix of live and dead ids can still emit what it found.
 */

/**
 * The Overlay fields the Export Hash is derived from, as a relational-query
 * fragment: `with: { clips: { with: { overlays: overlayExportRelation } } }`.
 *
 * Every query whose Clips end up in `computeExportHash` must include this, or
 * that Video's address would claim it has no Overlays and a Definition Card
 * edit — or a change of `kind` — would publish stale video. It lives here, next to the table's own
 * operations, so the four queries that need it cannot drift apart.
 */
export const overlayExportRelation = {
  columns: {
    at: true,
    durationInSeconds: true,
    kind: true,
    title: true,
    description: true,
  },
} as const;

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/** The columns every verb returns, in the order the CLI documents them. */
const overlayColumns = {
  id: overlays.id,
  clipId: overlays.clipId,
  at: overlays.at,
  durationInSeconds: overlays.durationInSeconds,
  kind: overlays.kind,
  title: overlays.title,
  description: overlays.description,
};

const createOverlayOperationsUnwrapped = (db: Database) => {
  /**
   * Every Overlay on a Video, in timeline order — its anchor Clip's `order`
   * first, then the anchor offset within that Clip.
   *
   * `clipId` narrows the result to one Clip's Overlays. It is a REQUIRED
   * parameter taking `null` for "the whole Video" rather than an optional one,
   * so no caller can silently widen the scope by forgetting to pass it.
   * Archived Clips are excluded — an archived Clip is a deleted Clip, and its
   * Overlays are off the timeline with it.
   */
  const listOverlaysByVideoId = Effect.fn("listOverlaysByVideoId")(function* (
    videoId: string,
    clipId: string | null
  ) {
    return yield* makeDbCall(() =>
      db
        .select(overlayColumns)
        .from(overlays)
        .innerJoin(clips, eq(overlays.clipId, clips.id))
        .where(
          and(
            eq(clips.videoId, videoId),
            eq(clips.archived, false),
            ...(clipId === null ? [] : [eq(overlays.clipId, clipId)])
          )
        )
        .orderBy(asc(clips.order), asc(overlays.at), asc(overlays.id))
    );
  });

  /** The Overlays among `overlayIds` that exist. Unknown ids are simply absent. */
  const getOverlaysByIds = Effect.fn("getOverlaysByIds")(function* (
    overlayIds: readonly string[]
  ) {
    if (overlayIds.length === 0) return [];
    return yield* makeDbCall(() =>
      db
        .select(overlayColumns)
        .from(overlays)
        .where(inArray(overlays.id, [...overlayIds]))
    );
  });

  const createOverlay = Effect.fn("createOverlay")(function* (overlay: {
    clipId: string;
    at: number;
    durationInSeconds: number;
    /** Omitted means the default, `definitionCard` — see overlay-kind.ts. */
    kind?: OverlayKind;
    title: string;
    description: string;
  }) {
    yield* requireDraftVersionForClip(db, overlay.clipId);
    const [created] = yield* makeDbCall(() =>
      db.insert(overlays).values(overlay).returning(overlayColumns)
    );
    if (!created) {
      return yield* new UnknownDBServiceError({
        cause: "No overlay was returned from the database",
      });
    }
    return created;
  });

  /**
   * Patch an Overlay in place. A new `clipId` RE-ANCHORS it — that is the only
   * way to move an Overlay between Clips, and it is why both the old and the
   * new Clip's owning Version are guarded here.
   */
  const updateOverlay = Effect.fn("updateOverlay")(function* (
    overlayId: string,
    patch: {
      clipId?: string;
      at?: number;
      durationInSeconds?: number;
      kind?: OverlayKind;
      title?: string;
      description?: string;
    }
  ) {
    yield* requireDraftVersionForOverlay(db, overlayId);
    if (patch.clipId !== undefined) {
      yield* requireDraftVersionForClip(db, patch.clipId);
    }
    const [updated] = yield* makeDbCall(() =>
      db
        .update(overlays)
        .set(patch)
        .where(eq(overlays.id, overlayId))
        .returning(overlayColumns)
    );
    return updated;
  });

  /**
   * HARD delete, echoing the row that was removed. There is no archived flag
   * to set and no restore verb: once deleted an Overlay is gone.
   */
  const deleteOverlay = Effect.fn("deleteOverlay")(function* (
    overlayId: string
  ) {
    yield* requireDraftVersionForOverlay(db, overlayId);
    const [deleted] = yield* makeDbCall(() =>
      db
        .delete(overlays)
        .where(eq(overlays.id, overlayId))
        .returning(overlayColumns)
    );
    return deleted;
  });

  return {
    listOverlaysByVideoId,
    getOverlaysByIds,
    createOverlay,
    updateOverlay,
    deleteOverlay,
  };
};

/** Each write runs in one txn with its draft-guard's version-row lock (#1403). */
export const createOverlayOperations = (db: Database) =>
  transactionalizeWrites(db, createOverlayOperationsUnwrapped, [
    "createOverlay",
    "updateOverlay",
    "deleteOverlay",
  ]);

export class OverlayOperationsService extends Effect.Service<OverlayOperationsService>()(
  "OverlayOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createOverlayOperations(db);
    }),
  }
) {}
