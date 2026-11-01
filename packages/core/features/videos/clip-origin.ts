/**
 * A Clip Origin: how a Clip came to exist (`clip.origin`).
 *
 * - `video-editor` — filmed or cut in the app: the CVM recorder, an OBS
 *   import, the editor UI. The default, and what every Clip from before
 *   Clip Origin existed holds.
 * - `cli` — created by the `cvm` CLI (`cvm clip add`): a Clip built from
 *   Footage that was already filmed, so it is not new filming.
 * - `copy` — the new Clip of a user-made copy: Create video from selection,
 *   Duplicate Video, Duplicate Course. The original
 *   stays where it was, so the copy is not new filming either.
 *
 * Only `video-editor` Clips count in the footage stats.
 *
 * A Submit is not a copy: its new Draft holds new Versions of the same
 * Videos, so each Clip keeps its original's Clip Origin (as it keeps
 * `createdAt`). The stats count only current Clips (a Draft's or a
 * standalone Video's), so stamping `copy` there would drop every Submitted
 * take from them. Create video from selection in "move" mode is not a copy
 * either: it archives the originals, so the moved Clip keeps its origin.
 *
 * Not to be confused with the `clip-source` package, which answers where a
 * Clip's picture and sound come from.
 */
export const CLIP_ORIGINS = ["video-editor", "cli", "copy"] as const;

export type ClipOrigin = (typeof CLIP_ORIGINS)[number];
