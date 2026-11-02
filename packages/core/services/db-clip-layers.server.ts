import { asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { clipLayers, clips } from "../db/schema.js";
import {
  clipLayersProblem,
  isUntouchedLayerSpecs,
  layersOrUntouched,
  layerSpecsFromRows,
  type ClipLayerSpec,
} from "../features/videos/clip-layer.js";
import { resolveVideoFormat } from "../features/videos/video-format.js";
import {
  clipLayersRelation,
  layerRowsFromSpecs,
} from "./clip-layers-relation.js";
import {
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
   * linked), judged against each Clip's Video Format and Recording Session.
   * Refused whole when any Clip cannot take them; each Clip's Version must
   * be a Draft.
   */
  const setClipLayers = Effect.fn("setClipLayers")(function* (
    clipIds: readonly string[],
    layers: readonly ClipLayerSpec[]
  ) {
    const found = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: inArray(clips.id, [...clipIds]),
        columns: { id: true },
        with: {
          video: { columns: { format: true } },
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
        format: resolveVideoFormat(clip.video.format),
        session: clip.recordingSession,
      });
      if (problem !== null) {
        return yield* new ClipLayersRefusedError({
          clipId,
          message: `Clip ${clipId}: ${problem}`,
        });
      }
    }

    yield* requireDraftVersionForClips(db, clipIds);
    yield* makeDbCall(() =>
      db.delete(clipLayers).where(inArray(clipLayers.clipId, [...clipIds]))
    );
    if (!isUntouchedLayerSpecs(layers)) {
      const rows = clipIds.flatMap((clipId) =>
        layerRowsFromSpecs(clipId, layers)
      );
      yield* makeDbCall(() => db.insert(clipLayers).values(rows));
    }
    return [...layers];
  });

  return { listClipLayers, setClipLayers };
};
