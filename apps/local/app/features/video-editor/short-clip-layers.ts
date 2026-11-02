import {
  clipLayersProblem,
  layersOrUntouched,
  layerSpecsFromRows,
  type ClipLayerRow,
  type ClipLayerSpec,
  type FootageLayerSpec,
  type LayerRect,
} from "@cvm/core/features/videos/clip-layer";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";

/**
 * The Portrait Studio's read-only view of a Short's Clip's Layers (ADR 0056):
 * each Layer as the list shows it, and what looks wrong with them. Editing
 * stays in the CLI (`cvm clip layer`); this only reads.
 */

/** A Short's Clip as these read it: its time in its source, and its Layers. */
export type ShortClipLayersInput = {
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
  readonly recordingSession?: { readonly screenCaptured: boolean } | null;
  /** Its stored Layers; none (or absent) is an untouched Clip. */
  readonly layers?: readonly ClipLayerRow[];
};

/** One Layer as the list shows it, bottom (index 0) to top. */
export type ClipLayerShown = {
  readonly index: number;
  readonly kind: "Scene" | "Footage";
  readonly footage: string;
  readonly sourceCrop: string;
  readonly placement: string;
  readonly volume: string;
  readonly span: string;
};

/** Something wrong with a Clip's Layers: on one Layer, or (null) the Clip. */
export type ClipLayerFlag = {
  readonly layer: number | null;
  readonly message: string;
};

const FRAME = VIDEO_FORMAT_DIMENSIONS.short;

const layersOf = (clip: ShortClipLayersInput): readonly ClipLayerSpec[] =>
  layersOrUntouched(layerSpecsFromRows(clip.layers ?? []));

const durationOf = (clip: ShortClipLayersInput) =>
  clip.sourceEndTime - clip.sourceStartTime;

/** Seconds, as few digits as say them: 1.5s, 12s. */
const seconds = (n: number) => `${Number(n.toFixed(3))}s`;

const rect = (r: LayerRect) => `${r.x}, ${r.y}, ${r.w} × ${r.h}`;

const footageText = (layer: FootageLayerSpec) =>
  layer.source.kind === "session"
    ? `Its Recording Session's ${layer.source.file}`
    : `${layer.source.path} from ${seconds(layer.source.start)}`;

const volumeText = (volume: number) =>
  volume === 0 ? "Muted" : `${Math.round(volume * 100)}%`;

/** Every Layer of the Clip, bottom to top; an untouched Clip's one Scene Layer. */
export const clipLayersShown = (clip: ShortClipLayersInput): ClipLayerShown[] =>
  layersOf(clip).map((layer, index) =>
    layer.kind === "scene"
      ? {
          index,
          kind: "Scene",
          footage: "Its own source",
          sourceCrop: "—",
          placement: "Scene layout",
          volume: volumeText(layer.volume),
          span: "Whole Clip",
        }
      : {
          index,
          kind: "Footage",
          footage: footageText(layer),
          sourceCrop: rect(layer.sourceCrop),
          placement: rect(layer.placement),
          volume: volumeText(layer.volume),
          span: layer.span
            ? `${seconds(layer.span.at)} to ${seconds(layer.span.at + layer.span.duration)}`
            : "Whole Clip",
        }
  );

/** Where in the Clip a Footage Layer draws, cut to the Clip. */
const drawnFrom = (layer: FootageLayerSpec, duration: number) => {
  const at = layer.span?.at ?? 0;
  const end = layer.span ? at + layer.span.duration : duration;
  return { at, end: Math.min(end, duration) };
};

const spanFlag = (layer: FootageLayerSpec, duration: number): string | null => {
  if (!layer.span) return null;
  const end = layer.span.at + layer.span.duration;
  if (layer.span.at >= duration) {
    return `Never drawn: its span starts at ${seconds(layer.span.at)}, after the Clip ends (${seconds(duration)})`;
  }
  if (end > duration + 1e-6) {
    return `Its span runs to ${seconds(end)}, past the Clip's end (${seconds(duration)}): it is cut there`;
  }
  return null;
};

const placementFlag = ({ x, y, w, h }: LayerRect): string | null => {
  if (x >= FRAME.width || y >= FRAME.height || x + w <= 0 || y + h <= 0) {
    return "Never seen: its Placement is off the frame";
  }
  if (x < 0 || y < 0 || x + w > FRAME.width || y + h > FRAME.height) {
    return `Partly outside the ${FRAME.width}x${FRAME.height} frame`;
  }
  return null;
};

/** The stretches of `[0, duration)` no Footage Layer's span covers. */
const uncovered = (layers: readonly FootageLayerSpec[], duration: number) => {
  const spans = layers
    .map((layer) => drawnFrom(layer, duration))
    .sort((a, b) => a.at - b.at);
  const gaps: { from: number; to: number }[] = [];
  let reached = 0;
  for (const span of spans) {
    if (span.at > reached + 1e-6) gaps.push({ from: reached, to: span.at });
    reached = Math.max(reached, span.end);
  }
  if (reached < duration - 1e-6) gaps.push({ from: reached, to: duration });
  return gaps;
};

/**
 * What looks wrong with a Short's Clip's Layers: anything its export would
 * refuse (`clipLayersProblem`), a span outside the Clip, a Placement outside
 * the 1080x1920 frame, stretches a Clip with no Scene Layer leaves black, and
 * a Clip with every Layer muted.
 */
export const clipLayerFlags = (clip: ShortClipLayersInput): ClipLayerFlag[] => {
  const layers = layersOf(clip);
  const invalid = clipLayersProblem(layers, {
    format: "short",
    session: clip.recordingSession ?? null,
  });
  if (invalid !== null) return [{ layer: null, message: invalid }];

  const duration = durationOf(clip);
  const flags: ClipLayerFlag[] = [];
  const footage: FootageLayerSpec[] = [];
  layers.forEach((layer, index) => {
    if (layer.kind !== "footage") return;
    footage.push(layer);
    const problem = spanFlag(layer, duration) ?? placementFlag(layer.placement);
    if (problem !== null) flags.push({ layer: index, message: problem });
  });

  const scene = layers.find((layer) => layer.kind === "scene");
  if (!scene) {
    for (const gap of uncovered(footage, duration)) {
      flags.push({
        layer: null,
        message: `Black from ${seconds(gap.from)} to ${seconds(gap.to)}: no Layer draws there`,
      });
    }
  }
  // With no Scene Layer the Clip's own sound plays at full.
  if (scene && layers.every((layer) => layer.volume === 0)) {
    flags.push({ layer: null, message: "Silent: every Layer's volume is 0" });
  }
  return flags;
};

/**
 * The Short's saved Clips whose Layers are flagged, in order, each with its
 * place among them (from 1) and its flags.
 */
export const shortClipsFlagged = <C extends ShortClipLayersInput>(
  clips: readonly C[]
): { clip: C; number: number; flags: ClipLayerFlag[] }[] =>
  clips.flatMap((clip, index) => {
    const flags = clipLayerFlags(clip);
    return flags.length === 0 ? [] : [{ clip, number: index + 1, flags }];
  });
