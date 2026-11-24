/**
 * The export's frame grid: every export, `cvm clip frame` and the editor's
 * previews count frames on it, so they all pick the same frame for a time.
 * The epsilon keeps a time computed in floating point on the frame it names
 * (2.5 s is frame 150, not 149.99…).
 */
export const EXPORT_FPS = 60;

export const EXPORT_FRAME_EPSILON = 1e-6;

/** Whole frames that cover `seconds`: a part frame counts as one. */
export const exportFrameCount = (seconds: number): number =>
  Math.ceil(seconds * EXPORT_FPS - EXPORT_FRAME_EPSILON);

/** The frame on screen `seconds` in: the last one begun. */
export const exportFrameAt = (seconds: number): number =>
  Math.floor(seconds * EXPORT_FPS + EXPORT_FRAME_EPSILON);

export const wholeExportFrameSeconds = (seconds: number): number =>
  exportFrameCount(seconds) / EXPORT_FPS;
