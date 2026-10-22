import { BITEXACT_ARGS, LANDSCAPE_VIDEO_ENCODE_ARGS } from "./ffmpeg-error";
import { ANIMATIC_FPS } from "@/features/animatic/animatic-timeline";

/**
 * One Clip Mockup of an Animatic as ffmpeg is handed it: its frame, its
 * voice, and how long it holds.
 */
export interface AnimaticEncodeSegment {
  /** The frame, an absolute path on a Storage Root. */
  readonly imageFile: string;
  /** The voice WAV, an absolute path on a Storage Root. */
  readonly audioFile: string;
  /**
   * Where the voice starts inside its WAV, past Kokoro's padding — where the
   * player starts it too, so the voice lands with its frame (#2265).
   */
  readonly speechStartSeconds: number;
  /**
   * Frames the segment holds at {@link ANIMATIC_FPS}: its speech and the gap
   * after it — `segmentFrames`, the player's own clock.
   */
  readonly durationInFrames: number;
}

/**
 * The ffmpeg command line that renders an Animatic to one file, exactly as
 * the player plays it: each frame held for its segment, its voice from the
 * onset, padded with silence to the segment's end.
 *
 * CHEAP ON THE CPU ON PURPOSE. Each frame is one image input, decoded ONCE,
 * fitted to the format's frame once, and then held by `tpad` cloning that
 * one frame — never `-loop 1`, which would decode the PNG again for every
 * frame of the hold. The picture is encoded on NVENC with the landscape
 * export's own settings ({@link LANDSCAPE_VIDEO_ENCODE_ARGS}), so a GPU that
 * cannot open falls back to the CPU in `runFfmpegWithProgress` exactly as a
 * Video export does, and a busy one is waited for rather than left.
 *
 * A frame of any size is fitted inside the frame with black bars, never
 * stretched: a Short's frames are already 1080x1920 and a Landscape Video's
 * 1920x1080, so in practice the fit is a no-op.
 */
export const buildAnimaticEncodeArgs = (opts: {
  segments: readonly AnimaticEncodeSegment[];
  dimensions: { width: number; height: number };
  outputFile: string;
}): string[] => {
  const { width, height } = opts.dimensions;
  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  opts.segments.forEach((segment, i) => {
    const imageInput = 2 * i;
    const audioInput = 2 * i + 1;
    const seconds = segment.durationInFrames / ANIMATIC_FPS;
    inputArgs.push(
      "-framerate",
      String(ANIMATIC_FPS),
      "-i",
      segment.imageFile,
      "-i",
      segment.audioFile
    );
    filterParts.push(
      `[${imageInput}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,` +
        `tpad=stop=${segment.durationInFrames - 1}:stop_mode=clone,` +
        `setpts=N/(${ANIMATIC_FPS}*TB)[v${i}]`,
      `[${audioInput}:a]atrim=start=${segment.speechStartSeconds},asetpts=PTS-STARTPTS,` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad=whole_dur=${seconds},atrim=end=${seconds}[a${i}]`
    );
    concatInputs.push(`[v${i}][a${i}]`);
  });
  filterParts.push(
    `${concatInputs.join("")}concat=n=${opts.segments.length}:v=1:a=1[outv][outa]`
  );

  return [
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
    "-movflags",
    "+faststart",
    ...BITEXACT_ARGS,
    opts.outputFile,
  ];
};

/** The whole Animatic in seconds, as its frames add up. */
export const animaticEncodeDurationSeconds = (
  segments: readonly AnimaticEncodeSegment[]
): number =>
  segments.reduce((total, s) => total + s.durationInFrames, 0) / ANIMATIC_FPS;
