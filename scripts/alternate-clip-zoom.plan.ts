/**
 * The rule this script exists to apply, kept pure and away from all I/O.
 *
 * A Clip Zoom is a manual, editorial choice — the product never applies one by
 * itself, and nothing here changes that. This is a one-shot authoring pass:
 * given a Video's Clips in timeline order, it says which Clip Zooms it WOULD
 * set. The runner (`alternate-clip-zoom.ts`) is what turns that into
 * `cvm clip update` calls, and only when asked to.
 *
 * THE RULE
 *   Find each maximal RUN of consecutive zoomable Clips — a stretch of camera
 *   scenes with no other scene cutting in. Where a run holds two or more Clips,
 *   alternate the Clip Zoom along it: none, subtle, none, subtle… so that every
 *   cut inside the run changes the shot. A single camera Clip standing alone
 *   has no neighbouring cut to play against, so it is never touched.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - It does not touch a Clip outside a run of two or more. A lone camera Clip
 *     you zoomed by hand keeps its zoom.
 *   - It does not touch a non-camera Clip. Those cannot be zoomed at all, and
 *     eligibility is read from `clip-zoom.ts` rather than restated here, so the
 *     scene list has exactly one home.
 *   - It knows nothing of Chapters. A Chapter is a marker on the timeline, not
 *     a cut in the footage, so a run reads straight through one.
 *
 * Inside a run, alternation starts at "none". The first Clip of a run therefore
 * renders as filmed, and the zoom reads as the departure it is.
 */

import {
  DEFAULT_CLIP_ZOOM_TYPE,
  canZoomClip,
  resolveClipZoomType,
  type ClipZoomType,
} from "../app/features/videos/clip-zoom";

/** The zoom a Clip alternates TO. Kept next to the rule that chooses it. */
const ALTERNATE_CLIP_ZOOM_TYPE: ClipZoomType = "subtle";

/** The fields of a Clip this pass reads. A subset of `cvm clip list` output. */
export type PlannedClip = {
  readonly id: string;
  readonly scene: string | null;
  readonly zoomType: string;
};

/** One Clip whose Clip Zoom the pass wants to change. */
export type ZoomChange = {
  readonly clipId: string;
  readonly from: ClipZoomType;
  readonly to: ClipZoomType;
  /** How many Clips are in the run this one belongs to (always >= 2). */
  readonly runLength: number;
  /** This Clip's 0-based position along that run. */
  readonly indexInRun: number;
};

/**
 * Split Clips into maximal stretches of consecutive zoomable ones. Anything
 * unzoomable ends the current run and starts no new one.
 */
const zoomableRuns = (
  clips: readonly PlannedClip[]
): ReadonlyArray<readonly PlannedClip[]> => {
  const runs: PlannedClip[][] = [];
  let current: PlannedClip[] = [];

  for (const clip of clips) {
    if (canZoomClip(clip.scene)) {
      current.push(clip);
      continue;
    }
    if (current.length > 0) runs.push(current);
    current = [];
  }
  if (current.length > 0) runs.push(current);

  return runs;
};

/**
 * The Clip Zoom a Clip should carry, by its position along a run of two or
 * more: even positions as filmed, odd positions zoomed.
 */
const zoomForPositionInRun = (indexInRun: number): ClipZoomType =>
  indexInRun % 2 === 0 ? DEFAULT_CLIP_ZOOM_TYPE : ALTERNATE_CLIP_ZOOM_TYPE;

/**
 * The changes this pass wants to make to one Video's Clips, which must be given
 * in timeline order. Clips already carrying the zoom the rule wants produce no
 * change, so the pass is idempotent: run it twice and the second run is empty.
 */
export const planZoomAlternation = (
  clips: readonly PlannedClip[]
): ZoomChange[] => {
  const changes: ZoomChange[] = [];

  for (const run of zoomableRuns(clips)) {
    // A lone camera Clip has no adjacent cut to alternate against.
    if (run.length < 2) continue;

    run.forEach((clip, indexInRun) => {
      const from = resolveClipZoomType(clip.zoomType);
      const to = zoomForPositionInRun(indexInRun);
      if (from === to) return;

      changes.push({
        clipId: clip.id,
        from,
        to,
        runLength: run.length,
        indexInRun,
      });
    });
  }

  return changes;
};
