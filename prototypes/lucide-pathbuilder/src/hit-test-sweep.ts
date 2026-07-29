/**
 * PROTOTYPE — throwaway. Does clicking an icon actually select it?
 *
 * Runs against a REAL Editor with the real `getShapeAtPoint`, called with the
 * exact options the select tool uses on a click
 * (SelectTool/childStates/Idle.ts: margin = hitTestMargin / zoom, hitInside:
 * false). Each icon gets a grid of sample points across its bounds; we record
 * whether the centre point hits and what fraction of the grid hits.
 *
 * A hollow `geo` rectangle of the same size is measured alongside as the
 * control: whatever tldraw already does for unfilled shapes is the bar.
 */

import { Vec, createShapeId } from "tldraw";
import type { Editor, TLShapeId } from "tldraw";
import { ICON_NAMES } from "./icon-shape-util";

export interface HitResult {
  name: string;
  centreHit: boolean;
  gridHits: number;
  gridTotal: number;
  edgeHit: boolean;
}

const GRID = 9;

function sweepShape(
  editor: Editor,
  id: TLShapeId,
  x: number,
  y: number,
  size: number,
  zoom: number,
): Omit<HitResult, "name"> {
  // The click margin is `hitTestMargin / zoom`, so the answer depends entirely
  // on the camera. Park the camera on this shape at a known zoom before asking.
  const vp = editor.getViewportScreenBounds();
  editor.setCamera({
    x: -(x + size / 2) + vp.w / 2 / zoom,
    y: -(y + size / 2) + vp.h / 2 / zoom,
    z: zoom,
  });
  const margin = editor.options.hitTestMargin / editor.getZoomLevel();
  const test = (px: number, py: number) =>
    editor.getShapeAtPoint(new Vec(px, py), {
      margin,
      hitInside: false,
      hitLabels: true,
      hitLocked: true,
      hitFrameInside: true,
    })?.id === id;

  const centreHit = test(x + size / 2, y + size / 2);

  let gridHits = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const px = x + (size * (i + 0.5)) / GRID;
      const py = y + (size * (j + 0.5)) / GRID;
      if (test(px, py)) gridHits++;
    }
  }

  // A point on the shape's bounding box edge, which for most glyphs is on or
  // very near an actual stroke.
  const edgeHit = test(x + size / 2, y);

  return { centreHit, gridHits, gridTotal: GRID * GRID, edgeHit };
}

export async function runHitTestSweep(
  editor: Editor,
  opts?: { sample?: number; size?: number; zoom?: number },
): Promise<{
  size: number;
  zoom: number;
  sample: number;
  centreHitRate: number;
  meanGridHitRate: number;
  edgeHitRate: number;
  control: { centreHit: boolean; gridHitRate: number };
  results: HitResult[];
}> {
  const size = opts?.size ?? 96;
  const zoom = opts?.zoom ?? 1;
  const sampleSize = opts?.sample ?? 200;

  const step = Math.max(1, Math.floor(ICON_NAMES.length / sampleSize));
  const names = ICON_NAMES.filter((_, i) => i % step === 0).slice(0, sampleSize);

  const created: TLShapeId[] = [];
  editor.selectAll().deleteShapes(editor.getSelectedShapeIds());

  // Lay the icons out far enough apart that no two can be candidates for the
  // same point.
  const GAP = size * 4;
  const COLS = 20;
  const placed: { id: TLShapeId; x: number; y: number }[] = [];
  names.forEach((name, i) => {
    const id = createShapeId();
    const x = (i % COLS) * GAP;
    const y = Math.floor(i / COLS) * GAP;
    editor.createShape({
      id,
      type: "lucide-icon",
      x,
      y,
      props: { name, w: size, h: size },
    });
    created.push(id);
    placed.push({ id, x, y });
  });

  // Control: a hollow geo rectangle, same size, off to the side.
  const controlId = createShapeId();
  const controlX = -GAP * 2;
  const controlY = 0;
  editor.createShape({
    id: controlId,
    type: "geo",
    x: controlX,
    y: controlY,
    props: { geo: "rectangle", w: size, h: size, fill: "none" },
  });

  await new Promise((r) => setTimeout(r, 100));

  const results: HitResult[] = placed.map(({ id, x, y }, i) => ({
    name: names[i]!,
    ...sweepShape(editor, id, x, y, size, zoom),
  }));

  const control = sweepShape(editor, controlId, controlX, controlY, size, zoom);

  editor.deleteShapes([...created, controlId]);

  return {
    size,
    zoom,
    sample: results.length,
    centreHitRate: results.filter((r) => r.centreHit).length / results.length,
    meanGridHitRate:
      results.reduce((acc, r) => acc + r.gridHits / r.gridTotal, 0) /
      results.length,
    edgeHitRate: results.filter((r) => r.edgeHit).length / results.length,
    control: {
      centreHit: control.centreHit,
      gridHitRate: control.gridHits / control.gridTotal,
    },
    results,
  };
}
