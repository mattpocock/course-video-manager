import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { CANVAS, type SceneSegment } from "@/packages/scene-layout";
import { cn } from "@/lib/utils";
import { drawComposite, type CompositeSourceFrame } from "../draw-composite";
import { useCompositePlayback } from "../use-composite-playback";

/** A picture `<video>`'s current frame, once it has one. */
const frameOf = (
  video: HTMLVideoElement | null
): CompositeSourceFrame | undefined =>
  video && video.videoWidth > 0 && video.readyState >= 2
    ? {
        image: video,
        size: { width: video.videoWidth, height: video.videoHeight },
      }
    : undefined;

/**
 * A new-recorder Clip played as the composite: its camera and screen files
 * play, muted and out of sight, in step with the clock `<video>` (the Clip's
 * mic, which carries the sound), and a canvas draws them every animation
 * frame with the layout module's draw instructions for the scene of the
 * moment — the same maths as the live preview and the export.
 */
export const CompositePlayback = (props: {
  clock: RefObject<HTMLVideoElement | null>;
  picture: {
    camera: string;
    screen: string;
    segments: readonly SceneSegment[];
  };
  offsetSeconds: number;
  hidden: boolean;
  className?: string;
  style?: CSSProperties;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { camera, screen, scene } = useCompositePlayback({
    clock: props.clock,
    segments: props.picture.segments,
    offsetSeconds: props.offsetSeconds,
  });

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || props.hidden) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      // Mid-seek a `<video>` has no frame to give: keep the last one drawn
      // rather than flash black.
      if (camera.current?.seeking || screen.current?.seeking) return;
      drawComposite(ctx, scene, {
        camera: frameOf(camera.current),
        screen: frameOf(screen.current),
      });
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [scene, props.hidden]);

  const offscreen = "pointer-events-none absolute size-px opacity-0";
  return (
    <>
      <canvas
        ref={canvasRef}
        width={CANVAS.width}
        height={CANVAS.height}
        className={cn("block w-full aspect-[16/9] bg-black", props.className)}
        style={props.style}
        data-testid="composite-playback"
        data-scene={scene}
      />
      <video
        ref={camera}
        src={props.picture.camera}
        muted
        playsInline
        preload="auto"
        className={offscreen}
      />
      <video
        ref={screen}
        src={props.picture.screen}
        muted
        playsInline
        preload="auto"
        className={offscreen}
      />
    </>
  );
};
