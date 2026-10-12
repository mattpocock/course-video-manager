// Entry point for the scene-layout package: the new recorder's scenes and
// their maths, pure (no filesystem, no ffmpeg), so the browser and the server
// share one definition.
//
// Given a Recording Session's scene events, a Clip's time range and an
// optional Scene Override, `sceneSegments` says which scene draws which part
// of the Clip. From one layout definition, `drawInstructions` says how a
// canvas draws a scene (live preview, editor playback) and `sceneFilterGraph`
// says how ffmpeg draws a run of segments (export, stills). `LAYOUT_VERSION`
// goes into the Export Hash.
export { DEFAULT_SCENE, SCENES, type Scene } from "./lib/layout-definition";
export {
  sceneSegments,
  type SceneEvent,
  type SceneSegment,
  type SceneSegmentsInput,
} from "./lib/scene-segments";
export {
  CANVAS,
  drawInstructions,
  sceneFilterGraph,
  type DrawInstruction,
  type SceneFilterGraphInput,
  type SourceSize,
} from "./lib/scene-drawing";

/** The layout definition's version: part of every new-recorder Export Hash. */
export { LAYOUT_VERSION } from "./lib/layout-definition";
