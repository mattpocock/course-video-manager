import type { VideoFormat } from "./video-format.js";

/**
 * A Clip's Layers as they are stored and written (ADR 0056): bottom to top,
 * each a **Scene Layer** or a **Footage Layer**. A Clip with none stored is
 * one Scene Layer at full volume ({@link UNTOUCHED_LAYER_SPECS}), so an
 * untouched Clip has no rows at all.
 *
 * The Clip Source package turns these into what the export draws; this module
 * only says what a valid list is.
 */

/** x, y, width and height. */
export type LayerRect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** The two files of the Clip's own Recording Session a Footage Layer may name. */
export const SESSION_FOOTAGE_FILES = ["camera", "screen"] as const;

export type SessionFootageFile = (typeof SESSION_FOOTAGE_FILES)[number];

/**
 * The Footage a Footage Layer draws: a file (root-relative, ADR 0040) from
 * `start` seconds in, or the camera or screen of the Clip's own Recording
 * Session, which shares the Clip's clock, so it needs no start and stays in
 * sync when the Clip is retimed or its Layers are copied to another Clip.
 */
export type FootageLayerSource =
  | { readonly kind: "file"; readonly path: string; readonly start: number }
  | { readonly kind: "session"; readonly file: SessionFootageFile };

/** Where in the Clip a Footage Layer is drawn: seconds from its start. */
export type LayerSpan = { readonly at: number; readonly duration: number };

export type SceneLayerSpec = {
  readonly kind: "scene";
  readonly volume: number;
};

export type FootageLayerSpec = {
  readonly kind: "footage";
  readonly source: FootageLayerSource;
  /** Fractions (0 to 1) of the Footage's frame. */
  readonly sourceCrop: LayerRect;
  /** Output pixels of the Video's frame. */
  readonly placement: LayerRect;
  readonly volume: number;
  /** Null: the whole Clip. */
  readonly span: LayerSpan | null;
};

export type ClipLayerSpec = SceneLayerSpec | FootageLayerSpec;

/** The Scene Layer's volume, and a new Footage Layer's. */
export const SCENE_LAYER_VOLUME = 1;
export const FOOTAGE_LAYER_VOLUME = 0;

export const WHOLE_SOURCE_CROP: LayerRect = { x: 0, y: 0, w: 1, h: 1 };

/** An untouched Clip's Layers: one Scene Layer at full volume. */
export const UNTOUCHED_LAYER_SPECS: readonly ClipLayerSpec[] = [
  { kind: "scene", volume: SCENE_LAYER_VOLUME },
];

/** A Clip's Layers as stored: none stored is an untouched Clip. */
export const layersOrUntouched = (
  stored: readonly ClipLayerSpec[]
): readonly ClipLayerSpec[] =>
  stored.length === 0 ? UNTOUCHED_LAYER_SPECS : stored;

/** Whether `layers` are an untouched Clip's, so nothing need be stored. */
export const isUntouchedLayerSpecs = (
  layers: readonly ClipLayerSpec[]
): boolean =>
  layers.length === 1 &&
  layers[0]!.kind === "scene" &&
  layers[0]!.volume === SCENE_LAYER_VOLUME;

/** One stored Layer row, as `clipLayersRelation` (core services) loads it. */
export type ClipLayerRow = {
  readonly position: number;
  readonly kind: "scene" | "footage";
  readonly footagePath: string | null;
  readonly footageStart: number | null;
  readonly sessionFile: SessionFootageFile | null;
  readonly cropX: number | null;
  readonly cropY: number | null;
  readonly cropW: number | null;
  readonly cropH: number | null;
  readonly placeX: number | null;
  readonly placeY: number | null;
  readonly placeW: number | null;
  readonly placeH: number | null;
  readonly volume: number;
  readonly spanAt: number | null;
  readonly spanDuration: number | null;
};

const num = (value: number | null): number => value ?? 0;

/** A stored Layer as the Layer it describes. */
export const layerSpecFromRow = (row: ClipLayerRow): ClipLayerSpec => {
  if (row.kind === "scene") return { kind: "scene", volume: row.volume };
  return {
    kind: "footage",
    source:
      row.sessionFile !== null
        ? { kind: "session", file: row.sessionFile }
        : {
            kind: "file",
            path: row.footagePath ?? "",
            start: num(row.footageStart),
          },
    sourceCrop: {
      x: num(row.cropX),
      y: num(row.cropY),
      w: num(row.cropW),
      h: num(row.cropH),
    },
    placement: {
      x: num(row.placeX),
      y: num(row.placeY),
      w: num(row.placeW),
      h: num(row.placeH),
    },
    volume: row.volume,
    span:
      row.spanAt === null || row.spanDuration === null
        ? null
        : { at: row.spanAt, duration: row.spanDuration },
  };
};

/** Stored Layers, bottom to top, as Layers. */
export const layerSpecsFromRows = (
  rows: readonly ClipLayerRow[]
): ClipLayerSpec[] =>
  [...rows].sort((a, b) => a.position - b.position).map(layerSpecFromRow);

const EPSILON = 1e-9;

const rectText = (r: LayerRect) => `${r.x},${r.y},${r.w},${r.h}`;

const cropProblem = (crop: LayerRect): string | null =>
  [crop.x, crop.y, crop.w, crop.h].every(
    (n) => Number.isFinite(n) && n >= 0 && n <= 1
  ) &&
  crop.w > 0 &&
  crop.h > 0 &&
  crop.x + crop.w <= 1 + EPSILON &&
  crop.y + crop.h <= 1 + EPSILON
    ? null
    : `Source Crop ${rectText(crop)} must be fractions of the Footage's ` +
      "frame: each 0 to 1, width and height above 0, and inside the frame";

const placementProblem = (placement: LayerRect): string | null =>
  [placement.x, placement.y, placement.w, placement.h].every(Number.isInteger)
    ? placement.w > 0 && placement.h > 0
      ? null
      : `Placement ${rectText(placement)} has no area: its width and height ` +
        "must be above 0"
    : `Placement ${rectText(placement)} must be whole output pixels`;

const footageProblem = (
  layer: FootageLayerSpec,
  session: { readonly screenCaptured: boolean } | null
): string | null => {
  const { source, span } = layer;
  if (source.kind === "session") {
    if (session === null) {
      return `its Footage is the Recording Session's ${source.file}, but the Clip has no Recording Session`;
    }
    if (source.file === "screen" && !session.screenCaptured) {
      return "its Footage is the Recording Session's screen, but that session captured no screen";
    }
  } else if (!Number.isFinite(source.start) || source.start < 0) {
    return `the Footage start (${source.start}) must be at or after 0`;
  }
  if (span && !(span.at >= 0 && span.duration > 0)) {
    return `the span (at ${span.at}, for ${span.duration}) must start at or after 0 and last more than 0 seconds`;
  }
  return cropProblem(layer.sourceCrop) ?? placementProblem(layer.placement);
};

/**
 * Why `layers` cannot be a Clip's, or null. On a Short any mix is allowed,
 * Footage Layers only included; on a Landscape Video only a Scene Layer at
 * the bottom with Footage Layers above it (until #2582). A Clip has at least
 * one Layer and at most one Scene Layer, and every volume is 0 to 1.
 */
export const clipLayersProblem = (
  layers: readonly ClipLayerSpec[],
  context: {
    readonly format: VideoFormat;
    readonly session: { readonly screenCaptured: boolean } | null;
  }
): string | null => {
  if (layers.length === 0) {
    return "a Clip needs at least one Layer";
  }
  const scenes = layers.filter((layer) => layer.kind === "scene").length;
  if (scenes > 1) {
    return "a Clip has at most one Scene Layer";
  }
  if (
    context.format === "landscape" &&
    (scenes === 0 || layers[0]!.kind !== "scene")
  ) {
    return (
      "on a Landscape Video a Clip's Layers are a Scene Layer at the bottom " +
      "with Footage Layers above it; other shapes are Shorts only for now"
    );
  }
  for (const [index, layer] of layers.entries()) {
    if (!(
      Number.isFinite(layer.volume) &&
      layer.volume >= 0 &&
      layer.volume <= 1
    )) {
      return `Layer ${index}: volume (${layer.volume}) must be 0 to 1`;
    }
    const problem =
      layer.kind === "footage" ? footageProblem(layer, context.session) : null;
    if (problem !== null) return `Layer ${index}: ${problem}`;
  }
  return null;
};
