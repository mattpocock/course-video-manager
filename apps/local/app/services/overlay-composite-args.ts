import { BITEXACT_ARGS, LANDSCAPE_VIDEO_ENCODE_ARGS } from "./ffmpeg-run";
import {
  buildOverlayCompositeFilterGraph,
  type RenderedOverlay,
} from "./overlay-compositing";

/**
 * The whole ffmpeg command line for the compositing pass, minus the program
 * name: the video, one input per rendered card, the graph that places them, and
 * the settings the finished file is written with.
 *
 * It encodes with {@link LANDSCAPE_VIDEO_ENCODE_ARGS} — what the concat pass
 * that MADE this file already used — rather than the Shorts burn-in's settings,
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
    ...overlays.flatMap((overlay) => ["-i", overlay.inputPath]),
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
