/**
 * Shared silence detection constants used by both the backend (ffmpeg-based)
 * and frontend (Web Audio API-based) silence/speech detection.
 *
 * The backend values are the source of truth.
 */

/** dB threshold below which audio is considered silence */
export const SILENCE_THRESHOLD_DB = -38;

/** Minimum clip length (in seconds) — clips shorter than this are discarded */
export const MINIMUM_CLIP_LENGTH_SECONDS = 1;

/**
 * Per-Recording-Session "Silence Length" mode (see CONTEXT.md).
 * Controls how long a silence must last before it ends a clip.
 * Applied symmetrically to the frontend speech detector and the backend
 * FFmpeg silence detection.
 */
export type SilenceLength = "short" | "long";

export const SILENCE_LENGTH_SHORT_SECONDS = 0.8;
export const SILENCE_LENGTH_LONG_SECONDS = 2.0;

export const DEFAULT_SILENCE_LENGTH: SilenceLength = "short";

export const silenceLengthToSeconds = (silenceLength: SilenceLength): number =>
  silenceLength === "short"
    ? SILENCE_LENGTH_SHORT_SECONDS
    : SILENCE_LENGTH_LONG_SECONDS;
