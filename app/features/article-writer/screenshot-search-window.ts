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

/**
 * How many moments the coarse pass is asked to rank.
 *
 * More than the grid holds, deliberately. The separation filter below discards
 * clustered picks, and without slack a run of near-neighbours would leave the
 * grid half empty. Two extra ranks cost two integers on a call already made.
 */
export const COARSE_CANDIDATE_COUNT = 6;

/** How many candidates the grid shows. */
export const MAX_CANDIDATES = 4;

/**
 * How far apart two candidates must sit to count as different moments.
 *
 * The seconds either side of a good frame also look good, so an unfiltered
 * ranking returns four views of one instant — four cells showing the same
 * thing, which is no choice at all. Two seconds is about where a screencast
 * has moved on to something else.
 */
export const MIN_MOMENT_SEPARATION_SECONDS = 2;

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
 * Thin a ranked list of moments down to ones that are genuinely distinct.
 *
 * Greedy in rank order: the best pick is always kept, and each next pick is
 * kept only if it is at least `minSeparation` from everything already held.
 * Rank order matters — dropping the *later* of two neighbours means the model's
 * own preference decides which of the pair survives.
 *
 * Enforced here rather than asked for in the prompt because "at least two
 * seconds apart" is arithmetic, and a model asked to do arithmetic over
 * timestamps it inferred from labels will occasionally get it wrong silently.
 */
export function selectDistinctMoments(
  ranked: FrameSample[],
  minSeparation: number = MIN_MOMENT_SEPARATION_SECONDS,
  max: number = MAX_CANDIDATES
): FrameSample[] {
  const kept: FrameSample[] = [];

  for (const sample of ranked) {
    if (kept.length >= max) break;
    const tooClose = kept.some(
      (k) => Math.abs(k.timestamp - sample.timestamp) < minSeparation
    );
    if (!tooClose) kept.push(sample);
  }

  return kept;
}

/** One candidate's neighbourhood of frames, for the fine pass. */
export interface FineSampleGroup {
  /** The coarse moment this group refines. */
  readonly center: number;
  readonly samples: FrameSample[];
}

/**
 * Neighbourhoods around every coarse candidate, for a single fine pass.
 *
 * All the groups go to the model in one call. Refining each candidate in its
 * own call would be four round trips for a judgement that benefits from seeing
 * the alternatives together.
 */
export function planFineSampleGroups(
  window: SearchWindow,
  centers: number[],
  interval: number = FINE_SAMPLE_INTERVAL_SECONDS,
  radius: number = FINE_SAMPLE_RADIUS
): FineSampleGroup[] {
  return centers.map((center) => ({
    center,
    samples: planFineSamples(window, center, interval, radius),
  }));
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
