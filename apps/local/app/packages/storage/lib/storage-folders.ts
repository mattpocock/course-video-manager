/**
 * The fixed subfolders every Storage Root has. A root-relative path names one
 * of these as its first segment (raw Footage is wherever OBS put it, which is
 * `raw-footage/` today; a CVM-recorder Recording Session is a folder of its
 * own under `raw-footage/`).
 *
 * Its own file, with no imports, so the browser-safe rules
 * (`imported-footage-rule.ts`) can read it.
 */
export const STORAGE_FOLDERS = {
  rawFootage: "raw-footage",
  finishedVideos: "finished-videos",
  clipMockups: "clip-mockups",
  overlayRenders: "overlay-renders",
  /** Video Files and the Thumbnail PNGs among them, by lineageId. */
  videoFiles: "video-files",
} as const;

export type StorageFolder =
  (typeof STORAGE_FOLDERS)[keyof typeof STORAGE_FOLDERS];
