import { VIDEO_FORMAT_DIMENSIONS, type VideoFormat } from "./video-format.js";

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

/** Whether `layers` draw the Clip's own scene: none stored is untouched. */
export const hasSceneLayer = (
  layers: readonly { readonly kind: ClipLayerSpec["kind"] }[]
): boolean =>
  layers.length === 0 || layers.some((layer) => layer.kind === "scene");

/**
 * Why `layers` cannot be a Clip's, or null. One rule on every Video Format
 * (#2604): any mix of Layers, with at least one Layer, at most one Scene
 * Layer, which is the bottom Layer, so the stored order is the order drawn.
 * Every volume is 0 to 1.
 */
export const clipLayersProblem = (
  layers: readonly ClipLayerSpec[],
  context: {
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
  const sceneAt = layers.findIndex((layer) => layer.kind === "scene");
  if (sceneAt > 0) {
    return (
      `the Scene Layer is Layer ${sceneAt}, but a Clip's Scene Layer must be ` +
      "its bottom Layer (index 0), with Footage Layers above it: move it " +
      `to the bottom first ('clip layer move --to 0 <clip> ${sceneAt}')`
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

/**
 * A stored Footage Layer moved from one Video format's frame into another's,
 * for a Clip copied across formats (`short create` from a Landscape Video)
 * or a Video whose format changes (`updateVideoFormat`).
 * Its Placement carries over by fractions of the frame, like the Scene
 * Layer's camera crops. The box changes shape, so its Source Crop is narrowed
 * about its centre to the box's new aspect: the picture is cropped, never
 * stretched — what a file drawn on a Short gets (scaled to cover, centre
 * crop). A Scene Layer, or a Layer kept in its own format, is unchanged.
 */
export const layerRowInVideoFormat = <R extends ClipLayerRow>(
  row: R,
  from: VideoFormat,
  to: VideoFormat
): R => {
  if (row.kind !== "footage" || from === to) return row;
  const was = VIDEO_FORMAT_DIMENSIONS[from];
  const now = VIDEO_FORMAT_DIMENSIONS[to];
  const placement = {
    x: num(row.placeX),
    y: num(row.placeY),
    w: num(row.placeW),
    h: num(row.placeH),
  };
  const crop = {
    x: num(row.cropX),
    y: num(row.cropY),
    w: num(row.cropW),
    h: num(row.cropH),
  };
  const scaleX = now.width / was.width;
  const scaleY = now.height / was.height;
  const x = Math.round(placement.x * scaleX);
  const y = Math.round(placement.y * scaleY);
  const w = Math.max(1, Math.round(placement.w * scaleX));
  const h = Math.max(1, Math.round(placement.h * scaleY));
  // The box's aspect, after over before: below 1 it grew taller, so keep the
  // middle of the crop's width; above 1, the middle of its height.
  const change = w / h / (placement.w / placement.h);
  const cropW = change < 1 ? crop.w * change : crop.w;
  const cropH = change > 1 ? crop.h / change : crop.h;
  return {
    ...row,
    placeX: x,
    placeY: y,
    placeW: w,
    placeH: h,
    cropX: crop.x + (crop.w - cropW) / 2,
    cropY: crop.y + (crop.h - cropH) / 2,
    cropW,
    cropH,
  };
};
