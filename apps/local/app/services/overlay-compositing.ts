/**
 * Where each Overlay lands on the flattened Video timeline, and the ffmpeg
 * filter graph that puts it there.
 *
 * Everything here is pure: Clips and Overlays in, seconds and a filter string
 * out. The pass that runs ffmpeg lives in the export step; this file is the
 * part worth reading, and the only part that can be wrong in a way a test can
 * catch — no test in this repo drives real ffmpeg.
 */

import {
  clipExportDurationInSeconds,
  expectedExportDurationInSeconds,
  type ExportClipDuration,
} from "./export-duration-check";
import type { DefinitionCardContent } from "./overlay-render-cache";

/**
 * One Overlay as the export address and the compositing pass both see it: a
 * Clip-relative anchor, a duration of its own, and the Definition Card content
 * to show. Structurally identical to `ExportOverlay`, and named separately
 * because this file asks a different question of it (where does it land?) than
 * the hash does (what does it say?).
 */
export type AnchoredOverlay = {
  /** Seconds from the start of the Clip this Overlay is anchored to. */
  at: number;
  durationInSeconds: number;
  title: string;
  description: string;
};

/**
 * One Overlay placed on the Video's own timeline: the seconds at which it
 * appears and disappears in the finished export.
 *
 * `content` is what the Overlay Render Cache is asked for. It carries the
 * Overlay's OWN `durationInSeconds`, not `endInSeconds - startInSeconds`: a
 * card truncated by the end of the Video is still rendered at full length, so
 * the same card at the end of one Video and the middle of another shares one
 * cached render.
 */
export type PlacedOverlay = {
  content: DefinitionCardContent;
  startInSeconds: number;
  /** Never past the end of the Video — a card that runs off the end is cut. */
  endInSeconds: number;
};

/**
 * Convert every Overlay's Clip-relative anchor into an absolute offset on the
 * finished Video's timeline.
 *
 * The export concatenates the Clips end to end, so a Clip's start on the
 * timeline is the sum of what every preceding Clip contributes — its padded
 * duration plus its long Pause, exactly the number ffmpeg is told to cut. The
 * Clips must arrive in playback order and with the archived ones already gone,
 * which is what `getVideoWithClipsById` returns and what the renderer is fed.
 *
 * An Overlay lasts as long as it says, not as long as its anchor Clip: one
 * that outlives its Clip keeps showing over the Clips that follow, and is cut
 * off at the end of the Video. An Overlay anchored past the end of the Video —
 * only reachable from data that no longer matches its Clip — is dropped rather
 * than composited into a span that does not exist.
 */
export const placeOverlaysOnTimeline = (
  clips: ReadonlyArray<{ overlays: ReadonlyArray<AnchoredOverlay> }>,
  clipDurations: ReadonlyArray<ExportClipDuration>
): PlacedOverlay[] => {
  const videoEndInSeconds = expectedExportDurationInSeconds(clipDurations);
  const placed: PlacedOverlay[] = [];
  let clipStartInSeconds = 0;

  clips.forEach((clip, index) => {
    const duration = clipDurations[index];
    for (const overlay of clip.overlays) {
      const startInSeconds = clipStartInSeconds + overlay.at;
      const endInSeconds = Math.min(
        startInSeconds + overlay.durationInSeconds,
        videoEndInSeconds
      );
      if (!(endInSeconds > startInSeconds)) continue;
      placed.push({
        content: {
          title: overlay.title,
          description: overlay.description,
          durationInSeconds: overlay.durationInSeconds,
        },
        startInSeconds,
        endInSeconds,
      });
    }
    clipStartInSeconds += duration ? clipExportDurationInSeconds(duration) : 0;
  });

  return placed;
};

/**
 * Seconds as the filter graph spells them.
 *
 * Fixed notation, because ffmpeg's expression parser reads `1e-7` as an
 * identifier followed by a subtraction, and millisecond resolution because
 * nothing finer than a frame can be seen.
 */
const formatSeconds = (seconds: number): string => seconds.toFixed(3);

/**
 * The `-filter_complex` graph that composites N Definition Cards onto one
 * video in a SINGLE ffmpeg pass.
 *
 * Input `0` is the video; input `i + 1` is the i-th Overlay's rendered `.mov`.
 * Each one is shifted onto its own place in the timeline with `setpts`, then
 * chained through its own `overlay` node gated by `enable='between(t,...)'`.
 * The chain is what keeps this one pass: a second Definition Card adds a node,
 * never another encode.
 *
 * Card renders start at frame 0 and last only as long as the card, so the
 * `setpts` shift is what puts a card's first frame at the moment it is meant to
 * appear; `eof_action=pass` and `repeatlast=0` then let the video run on
 * untouched once the card's own frames are spent.
 *
 * Returns `null` for no Overlays at all — the signal to skip the pass entirely,
 * which is what leaves a Video without Overlays byte-for-byte as it was.
 */
export const buildOverlayCompositeFilterGraph = (
  overlays: ReadonlyArray<{ startInSeconds: number; endInSeconds: number }>
): string | null => {
  if (overlays.length === 0) return null;

  const shifts = overlays.map(
    (overlay, index) =>
      `[${index + 1}:v]setpts=PTS-STARTPTS+${formatSeconds(overlay.startInSeconds)}/TB[ovl${index}]`
  );

  let current = "[0:v]";
  const chain = overlays.map((overlay, index) => {
    const isLast = index === overlays.length - 1;
    const output = isLast ? "[outv]" : `[comp${index}]`;
    const node =
      `${current}[ovl${index}]overlay=x=0:y=0:format=auto:eof_action=pass:repeatlast=0` +
      `:enable='between(t,${formatSeconds(overlay.startInSeconds)},${formatSeconds(overlay.endInSeconds)})'${output}`;
    current = output;
    return node;
  });

  return [...shifts, ...chain].join(";");
};
