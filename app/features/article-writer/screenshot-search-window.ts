import type { IndexedClip } from "./types";

/**
 * How many clips either side of the writer's `clipIndex` the search covers.
 *
 * The writer picks `clipIndex` from transcript *text*, so being a clip or two
 * early is systematic rather than exceptional — clips are short (median ~5s
 * across the corpus), and the thing being described is usually still on screen
 * a beat later. Two either side turns out to be ~30 seconds of footage, which
 * is small enough to search exhaustively in one pass.
 */
export const SEARCH_RADIUS_CLIPS = 2;

/** Seconds between frames in the coarse pass. */
export const COARSE_SAMPLE_INTERVAL_SECONDS = 1;

/** Seconds between frames in the fine pass. */
export const FINE_SAMPLE_INTERVAL_SECONDS = 0.2;

/** How many frames either side of the coarse winner the fine pass samples. */
export const FINE_SAMPLE_RADIUS = 2;

/** Height, in pixels, of coarse-pass frames. Cheaper; only used to localise. */
export const COARSE_FRAME_HEIGHT = 540;

/** Height, in pixels, of fine-pass frames. Matches the capture endpoint. */
export const FINE_FRAME_HEIGHT = 720;

export interface SearchWindow {
  /** Source file every clip in the window shares. */
  readonly videoFilename: string;
  /** The clips being searched, in index order, including the named one. */
  readonly clips: IndexedClip[];
  /** The clip the writer actually named. */
  readonly namedClip: IndexedClip;
}

/**
 * The clips a screenshot search should cover for a given `clipIndex`.
 *
 * Neighbours are only included when they share the named clip's source file.
 * A video is assembled from several recordings, so `clipIndex ± 2` can step
 * across a file boundary — and a timestamp means nothing without the file it
 * came from. Returns `null` when `clipIndex` matches no clip.
 */
export function computeSearchWindow(
  clips: IndexedClip[],
  clipIndex: number,
  radius: number = SEARCH_RADIUS_CLIPS
): SearchWindow | null {
  const namedClip = clips.find((c) => c.index === clipIndex);
  if (!namedClip) return null;

  const inWindow = clips
    .filter(
      (c) =>
        Math.abs(c.index - clipIndex) <= radius &&
        c.videoFilename === namedClip.videoFilename
    )
    .sort((a, b) => a.index - b.index);

  return { videoFilename: namedClip.videoFilename, clips: inWindow, namedClip };
}

export interface FrameSample {
  /** Absolute time in the source file. */
  readonly timestamp: number;
  /** Which clip this frame was drawn from. */
  readonly clipIndex: number;
  /** True when drawn from the clip the writer actually named. */
  readonly isNamedClip: boolean;
}

/**
 * Where to sample frames across a window, at `interval` seconds apart.
 *
 * Sampling walks each clip's own range rather than the window's outer bounds.
 * Clips are slices of a recording with the dead footage cut out, so adjacent
 * clip indices can sit minutes apart in the source file — sampling straight
 * across the gap would spend most of the budget on footage that was cut.
 *
 * Every clip yields at least one frame (its midpoint), however short it is.
 */
export function planCoarseSamples(
  window: SearchWindow,
  interval: number = COARSE_SAMPLE_INTERVAL_SECONDS
): FrameSample[] {
  const samples: FrameSample[] = [];

  for (const clip of window.clips) {
    const isNamedClip = clip.index === window.namedClip.index;
    const duration = clip.sourceEndTime - clip.sourceStartTime;

    if (duration < interval) {
      samples.push({
        timestamp: clip.sourceStartTime + duration / 2,
        clipIndex: clip.index,
        isNamedClip,
      });
      continue;
    }

    for (let t = clip.sourceStartTime; t <= clip.sourceEndTime; t += interval) {
      samples.push({ timestamp: t, clipIndex: clip.index, isNamedClip });
    }
  }

  return samples;
}

/**
 * Where to sample around a coarse winner, clamped to the window's footage.
 *
 * The clamp is per-clip: the winning frame's own clip bounds the refinement,
 * so a fine pass near a clip edge cannot wander into the cut footage on the
 * other side of it.
 */
export function planFineSamples(
  window: SearchWindow,
  center: number,
  interval: number = FINE_SAMPLE_INTERVAL_SECONDS,
  radius: number = FINE_SAMPLE_RADIUS
): FrameSample[] {
  const clip =
    window.clips.find(
      (c) => center >= c.sourceStartTime && center <= c.sourceEndTime
    ) ?? window.namedClip;

  const samples: FrameSample[] = [];
  for (let i = -radius; i <= radius; i++) {
    const timestamp = center + i * interval;
    if (timestamp < clip.sourceStartTime || timestamp > clip.sourceEndTime) {
      continue;
    }
    samples.push({
      timestamp,
      clipIndex: clip.index,
      isNamedClip: clip.index === window.namedClip.index,
    });
  }

  // A clip shorter than one interval can clamp away every offset.
  if (samples.length === 0) {
    samples.push({
      timestamp: center,
      clipIndex: clip.index,
      isNamedClip: clip.index === window.namedClip.index,
    });
  }

  return samples;
}
