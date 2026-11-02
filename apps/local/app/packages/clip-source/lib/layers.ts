import type { VideoFormat } from "@cvm/core/features/videos/video-format";

/**
 * A Clip's picture is its Layers, drawn bottom to top (ADR 0056). Overlays
 * and captions always draw above every Layer.
 *
 * Today the only Kind is the **Scene Layer**: the Clip's own source drawn in
 * its scene layout (an OBS or Imported Footage Clip's file, or a Recording
 * Session's camera and screen in its scenes). No Layers are stored yet, so
 * every Clip is exactly one Scene Layer, and draws, plays, stills and hashes
 * as it always has. Footage Layers join this union when they can be stored.
 */
export type SceneLayer = { readonly kind: "scene" };

export type Layer = SceneLayer;

/** The Layers of a Clip that has none stored: one Scene Layer. */
export const UNTOUCHED_CLIP_LAYERS: readonly Layer[] = [{ kind: "scene" }];

/** Whether the Layers draw the Clip's own source in its scene layout. */
export const drawsScene = (layers: readonly Layer[]): boolean =>
  layers.some((layer) => layer.kind === "scene");

/**
 * Whether the Layers are an untouched Clip's: exactly one Scene Layer. Such a
 * Clip adds nothing to the Export Hash, so every existing export keeps its
 * address.
 */
export const isUntouched = (layers: readonly Layer[]): boolean =>
  layers.length === 1 && layers[0]!.kind === "scene";

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
