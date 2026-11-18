/**
 * A Thumbnail at one of YouTube's sizes, as it reads on YouTube's dark
 * ground. It is drawn into a canvas sized to whole device pixels, with
 * high-quality smoothing: an `<img>` scaled by the browser at a fractional
 * display scale (Windows at 125%) showed a white right edge the exported PNG
 * never had.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

/** YouTube's dark-mode page colour. */
const YOUTUBE_DARK_GROUND = "#0f0f0f";

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of an image that fills a box, cropped evenly: CSS `object-fit: cover`. */
export function coverCrop(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number
): SourceRect {
  const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = boxWidth / scale;
  const height = boxHeight / scale;
  return {
    x: (imageWidth - width) / 2,
    y: (imageHeight - height) / 2,
    width,
    height,
  };
}

/** A preview box in whole device pixels, and the CSS size that shows them 1:1. */
export function previewCanvasSize(
  width: number,
  height: number,
  devicePixelRatio: number
) {
  const deviceWidth = Math.round(width * devicePixelRatio);
  const deviceHeight = Math.round(height * devicePixelRatio);
  return {
    deviceWidth,
    deviceHeight,
    cssWidth: deviceWidth / devicePixelRatio,
    cssHeight: deviceHeight / devicePixelRatio,
  };
}

/**
 * Fires when the display scale may have changed: the resolution query stops
 * matching when the window moves to another monitor, and browser zoom also
 * resizes the viewport.
 */
function subscribeToDevicePixelRatio(onChange: () => void) {
  let query: MediaQueryList | null = null;
  const listen = () => {
    query?.removeEventListener("change", handle);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", handle);
  };
  function handle() {
    listen();
    onChange();
  }
  listen();
  window.addEventListener("resize", handle);
  return () => {
    query?.removeEventListener("change", handle);
    window.removeEventListener("resize", handle);
  };
}

function useDevicePixelRatio(): number {
  return useSyncExternalStore(
    subscribeToDevicePixelRatio,
    () => window.devicePixelRatio,
    () => 1
  );
}

export function YouTubePreview({
  src,
  width,
  height,
  label,
}: {
  src: string;
  width: number;
  height: number;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = previewCanvasSize(width, height, useDevicePixelRatio());
  const { deviceWidth, deviceHeight } = size;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      ctx.fillStyle = YOUTUBE_DARK_GROUND;
      ctx.fillRect(0, 0, deviceWidth, deviceHeight);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const crop = coverCrop(
        image.naturalWidth,
        image.naturalHeight,
        deviceWidth,
        deviceHeight
      );
      ctx.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        deviceWidth,
        deviceHeight
      );
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, deviceWidth, deviceHeight]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div
        className="relative overflow-hidden rounded-lg"
        style={{
          width: size.cssWidth,
          height: size.cssHeight,
          background: YOUTUBE_DARK_GROUND,
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${label} preview`}
          width={deviceWidth}
          height={deviceHeight}
          className="block h-full w-full"
        />
        {/* Mock YouTube timestamp badge */}
        <div className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-xs font-medium leading-none text-white">
          12:34
        </div>
      </div>
    </div>
  );
}
