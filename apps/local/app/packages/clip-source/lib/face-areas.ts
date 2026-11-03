import { clipZoomRect } from "@cvm/core/features/videos/clip-zoom";
import { faceAreaDrawn } from "@cvm/core/features/videos/face-area";
import type { LayerRect } from "@cvm/core/features/videos/clip-layer";
import {
  CANVASES,
  drawInstructions,
  type SourceSize,
} from "@/packages/scene-layout";
import type { ClipSource } from "./clip-source";
import { footageLayers } from "./layers";

/**
 * Any size works: the layout's crops are fractions, read back as fractions.
 * Large, so the rounding to whole source pixels is negligible.
 */
const CAMERA: SourceSize = { width: 25600, height: 14400 };
const SCREEN: SourceSize = { width: 10800, height: 10800 };

/**
 * Where Matt's face can be drawn in a Clip's picture (#2669): the
 * Face Area (`FACE_AREA`) of every camera picture the Clip draws anywhere in it,
 * in pixels of the Video's frame. That is the Scene Layer's camera in each
 * scene of its range (with its Clip Zoom), and every Footage Layer of its
 * Recording Session's camera, over its whole span or not.
 *
 * A Footage Layer of a file is not a camera: its framing is unknown. An OBS
 * or Imported Footage Clip's Scene Layer is a file too.
 */
export const clipFaceAreas = (
  source: ClipSource,
  zoomType: string | null | undefined
): LayerRect[] => {
  const scene =
    source.kind === "recording-session" &&
    source.layers.some((layer) => layer.kind === "scene")
      ? sceneFaceAreas(source, zoomType)
      : [];
  const footage = footageLayers(source.layers).flatMap((layer) =>
    layer.source.kind === "session" && layer.source.file === "camera"
      ? [faceAreaDrawn(layer.sourceCrop, layer.placement)]
      : []
  );
  return [...scene, ...footage].filter((area) => area !== null);
};

const sceneFaceAreas = (
  source: Extract<ClipSource, { kind: "recording-session" }>,
  zoomType: string | null | undefined
) => {
  const canvas = CANVASES[source.format];
  const zoom = clipZoomRect(zoomType);
  const zoomed = (area: LayerRect): LayerRect => {
    if (!zoom) return area;
    const ox = zoom.originX * canvas.width;
    const oy = zoom.originY * canvas.height;
    return {
      x: ox + (area.x - ox) * zoom.scale,
      y: oy + (area.y - oy) * zoom.scale,
      w: area.w * zoom.scale,
      h: area.h * zoom.scale,
    };
  };
  const scenes = [...new Set(source.segments.map((s) => s.scene))];
  return scenes.flatMap((scene) =>
    drawInstructions(scene, { camera: CAMERA, screen: SCREEN }, source.format)
      .filter((draw) => draw.source === "camera")
      .map((draw) => {
        const area = faceAreaDrawn(
          {
            x: draw.sx / CAMERA.width,
            y: draw.sy / CAMERA.height,
            w: draw.sw / CAMERA.width,
            h: draw.sh / CAMERA.height,
          },
          { x: draw.dx, y: draw.dy, w: draw.dw, h: draw.dh }
        );
        return area && zoomed(area);
      })
  );
};
