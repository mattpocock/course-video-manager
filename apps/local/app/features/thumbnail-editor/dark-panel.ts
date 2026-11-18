/**
 * The dark panel a Thumbnail Diagram is drawn on: full frame height, as wide
 * as the drawing plus padding, with no outline. It is the shape a pasted
 * diagram PNG always had, without the author drawing a rectangle (whose
 * stroke tldraw always draws, as a thin light line).
 *
 * It is measured from what is IN the 16:9 frame only: a shape parked off the
 * frame does not widen it, and one straddling an edge counts up to that edge.
 * The editor and the export both draw it from this span, so they match.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./canvas-compositor";

/** Room the panel leaves around the drawing, in thumbnail pixels. */
export const DARK_PANEL_PADDING = 32;

export interface PageBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface DarkPanelSpan {
  x: number;
  width: number;
}

const overlapsFrame = (b: PageBounds) =>
  b.maxX > 0 && b.minX < CANVAS_WIDTH && b.maxY > 0 && b.minY < CANVAS_HEIGHT;

/** The panel behind these top-level shapes' bounds; null when none is in the frame. */
export function darkPanelSpan(
  shapes: readonly PageBounds[]
): DarkPanelSpan | null {
  const inFrame = shapes.filter(overlapsFrame);
  if (inFrame.length === 0) return null;
  const left = Math.max(0, Math.min(...inFrame.map((b) => b.minX)));
  const right = Math.min(CANVAS_WIDTH, Math.max(...inFrame.map((b) => b.maxX)));
  const x = Math.max(0, left - DARK_PANEL_PADDING);
  return {
    x,
    width: Math.min(CANVAS_WIDTH, right + DARK_PANEL_PADDING) - x,
  };
}
