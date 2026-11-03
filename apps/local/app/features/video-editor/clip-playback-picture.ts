import { clipZoomCssStyle } from "@/features/videos/clip-zoom";
import {
  clipLayers,
  drawsScene,
  type ClipSource,
} from "@/packages/clip-source";
import { overlayTransformStyle, type ClipOverlay } from "./overlay-preview";

/**
 * What the editor's playback draws at the bottom of a Clip's picture, as the
 * export's layered segment does: the Clip's own picture (its Scene Layer), or
 * black when it has no Scene Layer, on either Video Format. With no Scene
 * Layer the Clip's own `<video>` (its Footage, or a session Clip's mic) still
 * plays, hidden, as the playback clock and the Clip's sound.
 */
export type ClipPlaybackBase = "scene" | "black";

export const clipPlaybackBase = (source: ClipSource): ClipPlaybackBase =>
  drawsScene(clipLayers(source)) ? "scene" : "black";

type Style = { transform: string; transformOrigin?: string };

/**
 * The CSS the editor's playback puts on a Clip's picture at `currentTime`
 * (seconds into the Clip), as the export draws it:
 *
 * - `picture` wraps every Layer (the scene or the black base, and the
 *   Footage Layers above it). It carries the Transform of the Overlay on
 *   screen, because the export's composite pass slides the finished picture,
 *   Footage Layers included.
 * - `scene` is the Scene Layer alone. It carries the Clip Zoom, which zooms
 *   the Scene Layer only. A Transform and a Clip Zoom are never both in force
 *   (the write path refuses it); if they were, the Transform wins, as before.
 */
export const clipPlaybackStyles = (opts: {
  overlays: ClipOverlay[];
  currentTime: number;
  zoomType: string | null | undefined;
}): { picture: Style | undefined; scene: Style | undefined } => {
  const transform =
    overlayTransformStyle(opts.overlays, opts.currentTime) ?? undefined;
  return {
    picture: transform,
    scene: transform
      ? undefined
      : (clipZoomCssStyle(opts.zoomType) ?? undefined),
  };
};
