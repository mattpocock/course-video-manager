import {
  CANVAS,
  drawInstructions,
  type Scene,
  type SourceSize,
} from "@/packages/scene-layout";

/** A picture source with a frame to draw, and its size in its own pixels. */
export type CompositeSourceFrame = {
  readonly image: CanvasImageSource;
  readonly size: SourceSize;
};

/**
 * Draws one frame of the composite: black, then the scene's items from the
 * layout module's draw instructions, bottom to top. A source with no frame
 * yet is left out (black). Shared by the live preview and editor playback.
 */
export const drawComposite = (
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  sources: {
    readonly camera: CompositeSourceFrame | undefined;
    readonly screen: CompositeSourceFrame | undefined;
  }
) => {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);
  const fallback = { width: 1, height: 1 };
  for (const d of drawInstructions(scene, {
    camera: sources.camera?.size ?? fallback,
    screen: sources.screen?.size ?? fallback,
  })) {
    const source = sources[d.source];
    if (!source) continue;
    ctx.drawImage(source.image, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
  }
};
