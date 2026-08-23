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
import type { ExportOverlay } from "./export-hash";
import { BITEXACT_ARGS, LANDSCAPE_VIDEO_ENCODE_ARGS } from "./ffmpeg-run";

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
 * A {@link PlacedOverlay} once its Definition Card has actually been rendered:
 * the span it occupies, and the `.mov` to composite over that span. This is
 * everything the ffmpeg pass needs and nothing it does not — the card's content
 * has already done its job by naming the file.
 */
export type RenderedOverlay = {
  overlayPath: string;
  startInSeconds: number;
  endInSeconds: number;
};

/**
 * Pair a placed Overlay with the render the Overlay Render Cache handed back.
 *
 * It sits here, next to the type it reads, so the export step never has to
 * unpick a `PlacedOverlay`'s fields itself: adding a field to a placement is
 * this file's business, not the caller's.
 */
export const withRenderedCard = (
  placed: PlacedOverlay,
  overlayPath: string
): RenderedOverlay => ({
  overlayPath,
  startInSeconds: placed.startInSeconds,
  endInSeconds: placed.endInSeconds,
});

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
  clips: ReadonlyArray<{ overlays: ReadonlyArray<ExportOverlay> }>,
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

/**
 * The whole ffmpeg command line for the compositing pass, minus the program
 * name: the video, one input per rendered card, the graph that places them, and
 * the settings the finished file is written with.
 *
 * It encodes with {@link LANDSCAPE_VIDEO_ENCODE_ARGS} — what the concat pass
 * that MADE this file already used — rather than the Shorts burn-in's libx264,
 * so a course video carrying a Definition Card comes out with the same
 * characteristics as one that does not. The audio is stream-copied: the
 * normalize pass has already had its say, and re-encoding it here would only
 * lose a generation.
 *
 * Returns `null` when there is nothing to composite, for exactly the reason
 * {@link buildOverlayCompositeFilterGraph} does: the pass must be skipped, not
 * run over a video it would change nothing about.
 */
export const buildOverlayCompositeArgs = (
  videoPath: string,
  overlays: ReadonlyArray<RenderedOverlay>,
  outputPath: string
): string[] | null => {
  const filterGraph = buildOverlayCompositeFilterGraph(overlays);
  if (!filterGraph) return null;

  return [
    "-y",
    "-hide_banner",
    "-i",
    videoPath,
    ...overlays.flatMap((overlay) => ["-i", overlay.overlayPath]),
    "-filter_complex",
    filterGraph,
    "-map",
    "[outv]",
    "-map",
    "0:a",
    ...LANDSCAPE_VIDEO_ENCODE_ARGS,
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    ...BITEXACT_ARGS,
    outputPath,
  ];
};
