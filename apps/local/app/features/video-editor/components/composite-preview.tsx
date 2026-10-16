import { useEffect, useRef } from "react";
import type { VideoFormat } from "@/features/videos/video-format";
import { CANVASES, drawnSources, type Scene } from "@/packages/scene-layout";
import { PREVIEW_STALL_MS } from "recorder-service/protocol";
import { drawComposite } from "../draw-composite";
import { useLatestFrame } from "../use-latest-frame";

/**
 * The exact final picture, live: the recorder's camera and screen preview
 * feeds drawn on a canvas by the layout module's draw instructions for the
 * scene the recorder is in. Each feed's newest frame is pulled as it comes
 * (`useLatestFrame`); the canvas redraws them every animation frame. A feed with no frame yet
 * is left out (black). A feed whose newest frame is older than
 * `PREVIEW_STALL_MS` is left out too, and the canvas says it stalled: the
 * service is starting it again, and a frozen frame would look live (#2192). It fills the editor's live frame
 * (`LivePreviewFrame`). A Short is drawn in its own
 * 9:16 layout.
 */
/** "Screen preview stalled — restarting", over the black where it was. */
const drawStalled = (
  ctx: CanvasRenderingContext2D,
  feeds: readonly ("screen" | "camera")[],
  canvas: { width: number; height: number }
) => {
  ctx.save();
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(canvas.width / 30)}px sans-serif`;
  feeds.forEach((feed, i) =>
    ctx.fillText(
      `${feed === "screen" ? "Screen" : "Camera"} preview stalled — restarting`,
      canvas.width / 2,
      canvas.height / 2 + i * (canvas.width / 20)
    )
  );
  ctx.restore();
};

export const CompositePreview = (props: {
  previews: { camera: string; screen: string };
  scene: Scene;
  format: VideoFormat;
  /** Whether the camera feed has anything to show (the Cam Link is live or recording). */
  cameraShowing: boolean;
  /** Changes when the camera comes back, so its last frame is dropped. */
  cameraKey: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useLatestFrame(
    props.cameraShowing ? props.previews.camera : undefined,
    props.cameraKey
  );
  const screen = useLatestFrame(props.previews.screen);
  const { scene, format } = props;
  const canvas = CANVASES[format];

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const drawn = drawnSources([{ scene }], format);
    const draw = (nowMs: number) => {
      frame = requestAnimationFrame(draw);
      const live = (f: typeof camera.current) =>
        f && nowMs - f.atMs < PREVIEW_STALL_MS ? f.source : undefined;
      const sources = {
        camera: live(camera.current),
        screen: live(screen.current),
      };
      drawComposite(ctx, scene, sources, format);
      // Had a frame, and it went stale: stalled, not just not started yet.
      const feeds = { camera: camera.current, screen: screen.current };
      const stalled = (["screen", "camera"] as const).filter(
        (s) => drawn.includes(s) && feeds[s] && !sources[s]
      );
      if (stalled.length > 0) drawStalled(ctx, stalled, CANVASES[format]);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [scene, format, camera, screen]);

  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-lg bg-black"
      data-testid="cvm-recorder-composite"
      data-scene={scene}
      data-format={format}
    >
      <canvas
        ref={canvasRef}
        width={canvas.width}
        height={canvas.height}
        className="h-full w-full"
      />
    </div>
  );
};
