import type { VideoFormat } from "@/features/videos/video-format";

/**
 * How the editor's player frames a single-file Clip's Footage. On a Short it
 * fills the 9:16 frame, scaled to cover and centre-cropped — what the export's
 * `footageScaleFilter` does to it — so what plays is what ships. Elsewhere it
 * plays at its own aspect.
 */
export type FootagePlaybackFrame = "cover-portrait" | "own-aspect";

export const footagePlaybackFrame = (
  videoFormat: VideoFormat
): FootagePlaybackFrame =>
  videoFormat === "short" ? "cover-portrait" : "own-aspect";
