export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const TLDRAW_DARK_BACKGROUND = "hsl(240, 5%, 6.5%)";

export interface ThumbnailLayers {
  capturedPhoto: string | null;
  diagramImage: string | null;
  diagramPosition: number;
  cutoutImage: string | null;
  cutoutPosition: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawScaledLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  horizontalPosition: number
) {
  const scale = CANVAS_HEIGHT / img.naturalHeight;
  const scaledWidth = img.naturalWidth * scale;
  // Allow moving 80% off-screen in either direction (20% always visible)
  const minX = -0.8 * scaledWidth;
  const maxX = CANVAS_WIDTH - 0.2 * scaledWidth;
  const x = minX + (maxX - minX) * (horizontalPosition / 100);
  ctx.drawImage(img, x, 0, scaledWidth, CANVAS_HEIGHT);
}

/**
 * Computes the horizontal position (0-100 slider value) that places
 * a layer's left edge at x=0 on the canvas (left-aligned, fully visible).
 */
export function getLeftAlignedPosition(
  naturalWidth: number,
  naturalHeight: number
): number {
  const scale = CANVAS_HEIGHT / naturalHeight;
  const scaledWidth = naturalWidth * scale;
  const minX = -0.8 * scaledWidth;
  const maxX = CANVAS_WIDTH - 0.2 * scaledWidth;
  const range = maxX - minX;
  if (range === 0) return 50;
  // Solve: 0 = minX + range * (pos / 100)  →  pos = -minX / range * 100
  return (-minX / range) * 100;
}

/**
 * Composites all thumbnail layers onto the canvas and returns a data URL.
 * Returns null if the canvas context is unavailable or if the render was
 * cancelled (via signal.cancelled) before completion.
 */
export async function composeThumbnailLayers(
  canvas: HTMLCanvasElement,
  layers: ThumbnailLayers,
  signal?: { cancelled: boolean }
): Promise<string | null> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = TLDRAW_DARK_BACKGROUND;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Layer 1: Background photo (positioned to match cutout for hand-through-frame illusion)
  if (layers.capturedPhoto) {
    const bgImg = await loadImage(layers.capturedPhoto);
    if (signal?.cancelled) return null;
    drawScaledLayer(ctx, bgImg, layers.cutoutPosition);
  }

  // Layer 2: Diagram (scaled to full height, positioned horizontally)
  if (layers.diagramImage) {
    const diagImg = await loadImage(layers.diagramImage);
    if (signal?.cancelled) return null;
    drawScaledLayer(ctx, diagImg, layers.diagramPosition);
  }

  // Layer 3: Cutout (scaled to full height, positioned horizontally)
  if (layers.cutoutImage) {
    const cutoutImg = await loadImage(layers.cutoutImage);
    if (signal?.cancelled) return null;
    drawScaledLayer(ctx, cutoutImg, layers.cutoutPosition);
  }

  return canvas.toDataURL("image/png");
}
