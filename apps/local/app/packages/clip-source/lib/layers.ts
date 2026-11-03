import type { VideoFormat } from "@cvm/core/features/videos/video-format";
import {
  layersOrUntouched,
  SCENE_LAYER_VOLUME,
  type ClipLayerSpec,
  type FootageLayerSource,
  type LayerRect,
  layerSpecsFromRows,
  type ClipLayerRow,
} from "@cvm/core/features/videos/clip-layer";

/**
 * A Clip's picture is its Layers, drawn bottom to top (ADR 0056). Overlays
 * and captions always draw above every Layer.
 *
 * - The **Scene Layer** is the Clip's own source drawn in its scene layout
 *   (an OBS or Imported Footage Clip's file, or a Recording Session's camera
 *   and screen in its scenes). It carries the Clip's own sound at `volume`.
 * - A **Footage Layer** draws one Footage file: its Source Crop scaled to
 *   its Placement, over its span of the Clip, with its sound at `volume`.
 *
 * A Clip with no Layers stored is exactly one Scene Layer at full volume, and
 * draws, plays, stills and hashes as it always has.
 */
export type SceneLayer = { readonly kind: "scene"; readonly volume: number };

export type FootageLayer = {
  readonly kind: "footage";
  /** What was stored: a file, or the Clip's own session camera or screen. */
  readonly source: FootageLayerSource;
  /** The file it reads (a session's file once resolved). */
  readonly file: string;
  /** Seconds into `file` shown at the start of its span. */
  readonly start: number;
  readonly sourceCrop: LayerRect;
  readonly placement: LayerRect;
  readonly volume: number;
  /** Seconds from the Clip's start; `duration` null runs to the Clip's end. */
  readonly span: { readonly at: number; readonly duration: number | null };
};

export type Layer = SceneLayer | FootageLayer;

/** The Layers of a Clip that has none stored: one Scene Layer. */
export const UNTOUCHED_CLIP_LAYERS: readonly Layer[] = [
  { kind: "scene", volume: SCENE_LAYER_VOLUME },
];

/** Whether the Layers draw the Clip's own source in its scene layout. */
export const drawsScene = (layers: readonly Layer[]): boolean =>
  layers.some((layer) => layer.kind === "scene");

/**
 * Whether the Layers are an untouched Clip's: exactly one Scene Layer at full
 * volume. Such a Clip adds nothing to the Export Hash and takes the export
 * path it always took, so every existing export keeps its address and bytes.
 */
export const isUntouched = (layers: readonly Layer[]): boolean =>
  layers.length === 1 &&
  layers[0]!.kind === "scene" &&
  layers[0]!.volume === SCENE_LAYER_VOLUME;

/** The Footage Layers, bottom to top. */
export const footageLayers = (layers: readonly Layer[]): FootageLayer[] =>
  layers.filter((layer): layer is FootageLayer => layer.kind === "footage");

/**
 * The instant of its Footage a Footage Layer shows `elapsed` seconds into its
 * span: `start + elapsed`. On screen is the latest Footage frame AT OR
 * BEFORE that instant. The one rule the export (`clipSegmentArgs`, which
 * seeks without dropping the frame before an off-grid start) and the
 * editor's preview (`FootageLayersPreview`) both read, so they show the same
 * frame. B-roll's rule, carried over when B-roll became Footage Layers.
 */
export const footageLayerTime = (start: number, elapsed: number): number =>
  start + elapsed;

/**
 * A Clip's stored Layer rows as the Layers it draws. A Footage Layer naming
 * the Clip's own session camera or screen reads that file on the Clip's
 * clock: its start is the Clip's start plus where its span begins.
 */
export const resolveLayers = (
  rows: readonly ClipLayerRow[] | undefined,
  clip: {
    readonly start: number;
    readonly session: {
      readonly cameraFilePath: string;
      readonly screenFilePath: string;
    } | null;
  }
): readonly Layer[] =>
  layersOrUntouched(layerSpecsFromRows(rows ?? [])).map((spec) =>
    resolveLayer(spec, clip)
  );

const resolveLayer = (
  spec: ClipLayerSpec,
  clip: Parameters<typeof resolveLayers>[1]
): Layer => {
  if (spec.kind === "scene") return spec;
  const at = spec.span?.at ?? 0;
  const span = { at, duration: spec.span?.duration ?? null };
  const { source } = spec;
  if (source.kind === "file") {
    return { ...spec, file: source.path, start: source.start, span };
  }
  if (clip.session === null) {
    throw new Error(
      `A Footage Layer of the Recording Session's ${source.file} needs the Clip loaded with its Recording Session`
    );
  }
  return {
    ...spec,
    file:
      source.file === "camera"
        ? clip.session.cameraFilePath
        : clip.session.screenFilePath,
    start: clip.start + at,
    span,
  };
};

const rect = (r: LayerRect): [number, number, number, number] => [
  r.x,
  r.y,
  r.w,
  r.h,
];

/**
 * The Layers' Export Hash entry: every field of every Layer. A session file
 * is named, not its path: the Recording Session and the Clip's range are
 * already in the Clip's entry.
 */
export const layersHashPayload = (layers: readonly Layer[]) =>
  layers.map((layer) =>
    layer.kind === "scene"
      ? { k: "s", v: layer.volume }
      : {
          k: "f",
          ...(layer.source.kind === "file"
            ? { p: layer.source.path, s: layer.source.start }
            : { sf: layer.source.file }),
          c: rect(layer.sourceCrop),
          pl: rect(layer.placement),
          v: layer.volume,
          a: layer.span.at,
          d: layer.span.duration,
        }
  );

/**
 * The Video Format a CVM-recorder Clip's Scene Layer is drawn in: the
 * Video's. A Short draws every Clip in the Short layout, whatever format its
 * Recording Session was filmed in. A Landscape Video keeps each session's own
 * (a Short session's Clip on it is left as it is).
 */
export const sceneLayerFormat = (
  sessionFormat: VideoFormat,
  videoFormat: VideoFormat | undefined
): VideoFormat => (videoFormat === "short" ? "short" : sessionFormat);
