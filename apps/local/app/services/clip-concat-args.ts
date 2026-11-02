import { clipZoomCropFilter } from "@/features/videos/clip-zoom";
import { clipExportDurationInSeconds } from "./export-duration-check";
import {
  BITEXACT_ARGS,
  LANDSCAPE_VIDEO_ENCODE_ARGS,
  MANY_INPUT_DECODE_ARGS,
} from "./ffmpeg-error";

/** One Clip as the single-pass concat cuts it from its Footage. */
export type ConcatClip = {
  readonly inputVideo: string;
  readonly startTime: number;
  readonly duration: number;
  readonly pauseType: "none" | "long";
  readonly zoomType?: string;
};

/**
 * A Footage file's picture scaled to the export frame. On a Short (the
 * portrait frame) it covers the frame and is centre-cropped, never
 * stretched: a 16:9 file shows its middle, a 9:16 one all of itself. A
 * Landscape export scales exactly as it always has.
 */
export const footageScaleFilter = ({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}): string =>
  height > width
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}`;

/**
 * The single-pass concat's ffmpeg command line: every Clip cut from its
 * Footage as its own input, in order (so ffmpeg's input number IS the Clip's
 * position in the Video), normalized, and joined by the concat filter.
 *
 * Each input is decoded on two threads ({@link MANY_INPUT_DECODE_ARGS}):
 * ffmpeg opens all of them at once, and a decoder per Clip on every core is
 * what ran two Publishes out of memory.
 *
 * Also returns the summed `-t` values, which are the expected output duration
 * (the concat filter output is exactly the Clips end to end).
 */
export const buildClipConcatArgs = (opts: {
  clips: readonly ConcatClip[];
  dimensions: { width: number; height: number };
  outputFile: string;
}): { args: string[]; expectedOutputDuration: number } => {
  const { clips, dimensions } = opts;
  const inputArgs: string[] = [];
  let expectedOutputDuration = 0;
  for (const clip of clips) {
    const duration = clipExportDurationInSeconds(clip);
    expectedOutputDuration += duration;
    inputArgs.push(
      ...MANY_INPUT_DECODE_ARGS,
      "-ss",
      clip.startTime.toString(),
      "-t",
      duration.toString(),
      "-i",
      clip.inputVideo
    );
  }

  // Normalize every input to the target frame (and stereo audio) so the
  // concat filter — which requires all inputs to share dimensions/SAR/channel
  // layout — accepts odd effect clips (e.g. white noise at 854x480 mono). The
  // target dimensions come from the video's format: portrait 1080x1920 for
  // shorts (whose 9:16 subtitle overlay must line up), landscape 1920x1080
  // otherwise. Passing the wrong dimensions here is what previously forced
  // every export portrait.
  //
  // A Clip Zoom's crop goes BEFORE that scale, so a source larger than the
  // output frame is cropped and then scaled DOWN — the zoom spends surplus
  // resolution rather than upscaling. Cropping after the scale would discard
  // those pixels first and stretch what remained. The crop string comes from
  // clipZoomCropFilter, the same rect the editor preview's CSS transform is
  // formatted from.
  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const cropFilter = clipZoomCropFilter(clips[i]!.zoomType);
    filterParts.push(
      `[${i}:v]setpts=PTS-STARTPTS,${
        cropFilter ? `${cropFilter},` : ""
      }${footageScaleFilter(dimensions)},setsar=1[v${i}]`,
      `[${i}:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo[a${i}]`
    );
    concatInputs.push(`[v${i}][a${i}]`);
  }
  filterParts.push(
    `${concatInputs.join("")}concat=n=${clips.length}:v=1:a=1[outv][outa]`
  );

  const args = [
    "-y",
    "-hide_banner",
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    ...LANDSCAPE_VIDEO_ENCODE_ARGS,
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "320k",
    "-async",
    "1",
    "-movflags",
    "+faststart",
    ...BITEXACT_ARGS,
    opts.outputFile,
  ];
  return { args, expectedOutputDuration };
};
