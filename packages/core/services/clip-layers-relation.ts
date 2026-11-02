import { asc } from "drizzle-orm";
import { clipLayers } from "../db/schema.js";
import type {
  ClipLayerRow,
  ClipLayerSpec,
} from "../features/videos/clip-layer.js";

/**
 * The `layers` relation a Clip is loaded with wherever its picture is drawn
 * or hashed: its stored Layers, bottom to top. Every query whose Clips are
 * exported or hashed (`toExportClips`) loads it beside
 * `clipRecordingSessionRelation`; the type of `toExportClips` insists, or a
 * Clip with Footage Layers would be addressed as an untouched one.
 */
export const clipLayersRelation = {
  columns: {
    position: true,
    kind: true,
    footagePath: true,
    footageStart: true,
    sessionFile: true,
    cropX: true,
    cropY: true,
    cropW: true,
    cropH: true,
    placeX: true,
    placeY: true,
    placeW: true,
    placeH: true,
    volume: true,
    spanAt: true,
    spanDuration: true,
  },
  orderBy: asc(clipLayers.position),
} as const satisfies {
  columns: Record<keyof ClipLayerRow, true>;
  orderBy: unknown;
};

/** The rows that store `layers` on a Clip, bottom (position 0) to top. */
export const layerRowsFromSpecs = (
  clipId: string,
  layers: readonly ClipLayerSpec[]
): (typeof clipLayers.$inferInsert)[] =>
  layers.map((layer, position) => {
    const base = { clipId, position, kind: layer.kind, volume: layer.volume };
    if (layer.kind === "scene") return base;
    const { source, sourceCrop: c, placement: p, span } = layer;
    return {
      ...base,
      footagePath: source.kind === "file" ? source.path : null,
      footageStart: source.kind === "file" ? source.start : null,
      sessionFile: source.kind === "session" ? source.file : null,
      cropX: c.x,
      cropY: c.y,
      cropW: c.w,
      cropH: c.h,
      placeX: p.x,
      placeY: p.y,
      placeW: p.w,
      placeH: p.h,
      spanAt: span?.at ?? null,
      spanDuration: span?.duration ?? null,
    };
  });
