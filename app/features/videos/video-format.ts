export const VIDEO_FORMATS = ["standard", "short"] as const;

export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const DEFAULT_VIDEO_FORMAT: VideoFormat = "standard";

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = {
  standard: "Standard",
  short: "Short",
};
