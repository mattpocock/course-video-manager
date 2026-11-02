import type { VideoFormat } from "@cvm/core/features/videos/video-format";
import {
  drawnSources,
  SCENES,
  type LayoutSource,
  type Scene,
} from "@/packages/scene-layout";

/**
 * The scenes a Clip of this Recording Session may be overridden to: every
 * scene, or — when the session captured no screen — only those that draw no
 * screen (Camera).
 */
export const sceneOverrideScenes = (session: {
  readonly format: VideoFormat;
  readonly screenCaptured: boolean;
}): Scene[] =>
  session.screenCaptured
    ? [...SCENES]
    : SCENES.filter(
        (scene) => !drawnSources([{ scene }], session.format).includes("screen")
      );

/**
 * The recordings a composite of `segments` opens, in input order. A Landscape
 * composite opens screen and camera whatever it draws (its ffmpeg arguments
 * and Export Hash are pinned); a Short opens only what its segments draw, so
 * a Camera-only run never asks for a screen (a camera-only session has none).
 */
export const compositeSources = (
  format: VideoFormat,
  segments: readonly { readonly scene: Scene }[]
): LayoutSource[] =>
  format === "landscape"
    ? ["screen", "camera"]
    : drawnSources(segments, format);

/** The file of each source a composite opens; throws on a screen it lacks. */
export const compositeFiles = (
  composite: {
    readonly format: VideoFormat;
    readonly screen: string | null;
    readonly camera: string;
  },
  segments: readonly { readonly scene: Scene }[]
): { source: LayoutSource; file: string }[] =>
  compositeSources(composite.format, segments).map((source) => {
    const file = source === "screen" ? composite.screen : composite.camera;
    if (file === null) {
      throw new Error(
        "This Recording Session captured no screen, so only the Camera scene can be drawn"
      );
    }
    return { source, file };
  });
