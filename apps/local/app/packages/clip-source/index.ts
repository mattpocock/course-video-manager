// Entry point (public, browser-safe) for the clip-source package.
//
// A deep module answering one question: "how do I get this Clip's picture and
// sound?" Editor playback, stills, the Article Writer's screenshot picker, the
// export and its Export Hash, the vertical render and Clip transcription all ask
// it, instead of reading the Clip's Footage path column themselves.
//
// Two answers, behind the same functions: a single Footage file with a start
// and end time (an OBS Clip), or a Recording Session's camera, screen and mic
// files with the scene segments the layout module draws and the mic offset (a
// CVM-recorder Clip, when the row is loaded with its `recordingSession`).
// `clipComposite` says what the export draws for a CVM-recorder Clip, drawn
// in the Video's format (a Short draws every Clip in the Short layout; a
// Landscape Video keeps its session's own); `compositeFiles` says which files a
// run of its segments opens (a Short opens only what it draws);
// `sceneOverrideScenes` says which scenes a Scene Override may pick (only
// Camera on a session that captured no screen).
//
// A Clip's picture is its Layers (ADR 0056): `clipLayers` lists them, bottom
// to top, and every picture function here draws from them. A Clip with none
// stored is one Scene Layer, and draws, plays and hashes as it always did.
export {
  clipComposite,
  clipCompositePicture,
  clipFfmpegInput,
  clipFrame,
  clipFrameFfmpegArgs,
  clipLayers,
  clipPlaybackClock,
  clipPlaybackUrl,
  clipScreenPicture,
  sceneAt,
  clipSource,
  clipSourceColumns,
  clipSourceHashFields,
  type ClipComposite,
  type ClipFfmpegInput,
  type ClipFrame,
  type ClipRecordingSession,
  type ClipSource,
  type ClipSourceColumns,
  type ClipSourceRow,
} from "./lib/clip-source";
export { compositeFiles, sceneOverrideScenes } from "./lib/composite-files";
export { mapClipFrameFiles, mapClipSourceFiles } from "./lib/map-files";
export {
  isUntouched,
  footageLayers,
  footageLayerTime,
  type FootageLayer,
  type Layer,
  type SceneLayer,
} from "./lib/layers";
export { clampCrop, type ScreenCrop } from "./lib/screen-crop";
