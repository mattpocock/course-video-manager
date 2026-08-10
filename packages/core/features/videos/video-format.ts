export const VIDEO_FORMATS = ["landscape", "short"] as const;

export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const DEFAULT_VIDEO_FORMAT: VideoFormat = "landscape";

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = {
  landscape: "Landscape",
  short: "Short",
};

/**
 * The output frame dimensions each format is exported at. `short` is portrait
 * 9:16; everything else is landscape 16:9. These drive the ffmpeg `scale`
 * target during concatenation, so an export lands in the aspect ratio that
 * matches the video's format instead of always being portrait.
 */
export const VIDEO_FORMAT_DIMENSIONS: Record<
  VideoFormat,
  { width: number; height: number }
> = {
  landscape: { width: 1920, height: 1080 },
  short: { width: 1080, height: 1920 },
};

/**
 * Coerce a raw `format` string (e.g. from the DB column) into a known
 * {@link VideoFormat}, falling back to {@link DEFAULT_VIDEO_FORMAT} (landscape)
 * for anything unrecognised. Anything not explicitly a portrait `short` is
 * treated as landscape.
 */
export function resolveVideoFormat(
  format: string | null | undefined
): VideoFormat {
  return (VIDEO_FORMATS as readonly string[]).includes(format ?? "")
    ? (format as VideoFormat)
    : DEFAULT_VIDEO_FORMAT;
}
