import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Effect } from "effect";
import { clipLayers, clips } from "../db/schema.js";
import { DEFAULT_CLIP_ZOOM_TYPE } from "../features/videos/clip-zoom.js";
import {
  clipLayersProblem,
  hasSceneLayer,
  isUntouchedLayerSpecs,
  layersOrUntouched,
  layerSpecsFromRows,
  type ClipLayerSpec,
} from "../features/videos/clip-layer.js";
import {
  clipLayersRelation,
  layerRowsFromSpecs,
} from "./clip-layers-relation.js";
import {
  ClipLayersChangedError,
  ClipLayersRefusedError,
  NotFoundError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { requireDraftVersionForClips } from "./draft-guard.server.js";
import type { Database } from "./drizzle-service.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/**
 * A Clip's Layers (ADR 0056): read whole and written whole. A Clip with none
 * stored reads as one Scene Layer; writing that back stores nothing, so the
 * Clip is untouched again and hashes as it always did.
 */
export const createClipLayerOperationsUnwrapped = (db: Database) => {
  /** The Clip's Layers, bottom to top. */
  const listClipLayers = Effect.fn("listClipLayers")(function* (
    clipId: string
  ) {
    const rows = yield* makeDbCall(() =>
      db.query.clipLayers.findMany({
        where: eq(clipLayers.clipId, clipId),
        columns: clipLayersRelation.columns,
        orderBy: asc(clipLayers.position),
      })
    );
    return [...layersOrUntouched(layerSpecsFromRows(rows))];
  });

  /**
   * Set every one of `clipIds`' Layers to `layers` (a copy each: nothing is
   * linked), judged against each Clip's Recording Session. Layers with no
   * Scene Layer drop the Clips' Clip Zoom.
   * Refused whole when any Clip cannot take them; each Clip's Version must
   * be a Draft.
   *
   * `expected` makes it a compare-and-set (#2598): the Layers the caller
   * read and edited. The Clips' rows are locked `FOR UPDATE`, so a second
   * writer waits for the first to commit, then sees its Layers; when any
   * Clip's Layers are not `expected` any more it is refused whole
   * (`ClipLayersChangedError`) rather than overwriting the other edit. Only
   * race-safe inside a transaction: it runs under `transactionalizeWrites`.
   */
  const setClipLayers = Effect.fn("setClipLayers")(function* (
    clipIds: readonly string[],
    layers: readonly ClipLayerSpec[],
    expected?: readonly ClipLayerSpec[]
  ) {
    const found = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: inArray(clips.id, [...clipIds]),
        columns: { id: true },
        with: {
          recordingSession: { columns: { screenCaptured: true } },
        },
      })
    );
    const byId = new Map(found.map((clip) => [clip.id, clip]));
    for (const clipId of clipIds) {
      const clip = byId.get(clipId);
      if (!clip) {
        return yield* new NotFoundError({
          type: "setClipLayers",
          params: { clipId },
        });
      }
      const problem = clipLayersProblem(layers, {
        session: clip.recordingSession,
      });
      if (problem !== null) {
        return yield* new ClipLayersRefusedError({
          clipId,
          message: `Clip ${clipId}: ${problem}`,
        });
      }
    }

    // The Draft guard's version-row lock first, then the Clip rows (sorted):
    // after the guard, as every Clip write's UPDATE is, so none deadlock.
    yield* requireDraftVersionForClips(db, clipIds);
    yield* makeDbCall(() =>
      db
        .select({ id: clips.id })
        .from(clips)
        .where(inArray(clips.id, [...clipIds]))
        .orderBy(asc(clips.id))
        .for("update")
    );
    if (expected !== undefined) {
      for (const clipId of clipIds) {
        const current = yield* listClipLayers(clipId);
        if (!isDeepStrictEqual(current, [...expected])) {
          return yield* new ClipLayersChangedError({
            clipId,
            message:
              `Clip ${clipId}: its Layers changed since this command read them ` +
              "(another edit landed first). Nothing was written; run the command " +
              "again to edit the Layers as they are now.",
          });
        }
      }
    }
    yield* makeDbCall(() =>
      db.delete(clipLayers).where(inArray(clipLayers.clipId, [...clipIds]))
    );
    if (!isUntouchedLayerSpecs(layers)) {
      const rows = clipIds.flatMap((clipId) =>
        layerRowsFromSpecs(clipId, layers)
      );
      yield* makeDbCall(() => db.insert(clipLayers).values(rows));
    }
    // A Clip Zoom zooms the Scene Layer only: Layers without one drop it in
    // the same write, as a Scene Override that leaves a camera scene does.
    if (!hasSceneLayer(layers)) {
      yield* makeDbCall(() =>
        db
          .update(clips)
          .set({ zoomType: DEFAULT_CLIP_ZOOM_TYPE })
          .where(
            and(
              inArray(clips.id, [...clipIds]),
              ne(clips.zoomType, DEFAULT_CLIP_ZOOM_TYPE)
            )
          )
      );
    }
    return [...layers];
  });

  return { listClipLayers, setClipLayers };
};
