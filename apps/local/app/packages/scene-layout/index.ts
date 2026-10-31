// Entry point for the scene-layout package: the CVM recorder's scenes and
// their maths, pure (no filesystem, no ffmpeg), so the browser and the server
// share one definition.
//
// Each Video Format has its own layout of the same three scenes (Landscape
// 1920x1080, Short 1080x1920); every function takes the format and defaults
// to Landscape. `drawnSources` says which recordings a run of segments needs.
//
// Given a Recording Session's scene events, a Clip's time range and an
// optional Scene Override, `sceneSegments` says which scene draws which part
// of the Clip. From one layout definition, `drawInstructions` says how a
// canvas draws a scene (live preview, editor playback) and `sceneFilterGraph`
// says how ffmpeg draws a run of segments (export, stills). `LAYOUT_VERSIONS`
// goes into the Export Hash. `liveSceneFilterGraph` draws every Landscape
// scene at once on CUDA for the Live Stream and picks one; `liveSceneSwitch`
// is the filter command that switches it live; `liveCameraSize` is the camera
// scaled to the most any of its scenes draws of it.
export {
  DEFAULT_SCENE,
  LAYOUT_VERSIONS,
  SCENES,
  type LayoutSource,
  type Scene,
} from "./lib/layout-definition";
export {
  sceneSegments,
  type SceneEvent,
  type SceneSegment,
  type SceneSegmentsInput,
} from "./lib/scene-segments";
export {
  CANVAS,
  CANVASES,
  drawInstructions,
  drawnSources,
  sceneFilterGraph,
  type DrawInstruction,
  type SceneFilterGraphInput,
  type SourceSize,
} from "./lib/scene-drawing";

export {
  liveSceneFilterGraph,
  liveSceneSwitch,
  liveCameraSize,
  type LiveSceneFilterGraphInput,
} from "./lib/live-scene-graph";

/** The Landscape layout's version: part of every Landscape CVM-recorder Export Hash. */
export { LAYOUT_VERSION } from "./lib/layout-definition";
