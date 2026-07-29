/**
 * PROTOTYPE — throwaway. Resolution-independent fidelity measurement.
 *
 * Pixel diffs conflate antialiasing with real geometry error. This measures the
 * geometry directly: sample dense points along the source elements and along
 * the transpiled path (using the browser's own SVGGeometryElement.
 * getPointAtLength, i.e. Chrome's path maths, not ours), then compute the
 * symmetric Hausdorff distance between the two point sets.
 *
 * Units are SVG user units in lucide's 24x24 box, so an error of 0.024 = 0.1%
 * of the icon's width, whatever size the shape is rendered at.
 */

import { ICONS, ICON_NAMES } from "./icon-shape-util";
import {
  iconNodeToPathBuilder,
  LUCIDE_VIEWBOX,
  type IconNode,
} from "./lucide-to-path-builder";

const SVG_NS = "http://www.w3.org/2000/svg";
const SAMPLE_STEP = 0.02; // user units — the measurement floor is ~SAMPLE_STEP/2
const QUERY_STRIDE = 1;
const CELL = 0.5;

function makeSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.style.position = "absolute";
  svg.style.opacity = "0";
  svg.style.pointerEvents = "none";
  document.body.appendChild(svg);
  return svg;
}

function samplePoints(el: SVGGeometryElement): number[] {
  const len = el.getTotalLength();
  const out: number[] = [];
  const steps = Math.max(2, Math.ceil(len / SAMPLE_STEP));
  for (let i = 0; i <= steps; i++) {
    const p = el.getPointAtLength((len * i) / steps);
    out.push(p.x, p.y);
  }
  return out;
}

function sampleNode(svg: SVGSVGElement, node: IconNode): number[] {
  const out: number[] = [];
  for (const [tag, attrs] of node) {
    const el = document.createElementNS(SVG_NS, tag) as SVGGeometryElement;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "key") continue;
      el.setAttribute(k, String(v));
    }
    svg.appendChild(el);
    out.push(...samplePoints(el));
    el.remove();
  }
  return out;
}

function sampleD(svg: SVGSVGElement, d: string): number[] {
  const el = document.createElementNS(SVG_NS, "path");
  el.setAttribute("d", d);
  svg.appendChild(el);
  const out = samplePoints(el);
  el.remove();
  return out;
}

/** Uniform grid for nearest-neighbour queries. */
class Grid {
  private cells = new Map<string, number[]>();
  constructor(readonly pts: number[]) {
    for (let i = 0; i < pts.length; i += 2) {
      const key = `${Math.floor(pts[i]! / CELL)},${Math.floor(pts[i + 1]! / CELL)}`;
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, (bucket = []));
      bucket.push(i);
    }
  }
  nearest(x: number, y: number): number {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best = Infinity;
    for (let ring = 0; ring < 60; ring++) {
      for (let i = cx - ring; i <= cx + ring; i++) {
        for (let j = cy - ring; j <= cy + ring; j++) {
          if (ring > 0 && Math.abs(i - cx) !== ring && Math.abs(j - cy) !== ring)
            continue;
          const bucket = this.cells.get(`${i},${j}`);
          if (!bucket) continue;
          for (const idx of bucket) {
            const dx = this.pts[idx]! - x;
            const dy = this.pts[idx + 1]! - y;
            const d = Math.hypot(dx, dy);
            if (d < best) best = d;
          }
        }
      }
      // once we have a hit, one more ring is enough to be safe
      if (best < ring * CELL) break;
    }
    return best;
  }
}

export interface GeometryError {
  name: string;
  /** worst deviation, in 24-unit icon space */
  maxError: number;
  /** mean deviation over all samples */
  meanError: number;
  /** maxError as a percentage of the icon's width */
  maxErrorPct: number;
  error?: string;
}

export async function runGeometrySweep(opts?: {
  names?: string[];
  onProgress?(done: number, total: number): void;
}): Promise<{
  total: number;
  exact: number;
  errors: GeometryError[];
  results: GeometryError[];
}> {
  const names = opts?.names ?? ICON_NAMES;
  const svg = makeSvg();
  const results: GeometryError[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    try {
      const node = ICONS[name]!;
      const src = sampleNode(svg, node);
      const out = sampleD(
        svg,
        iconNodeToPathBuilder(node, LUCIDE_VIEWBOX).toD(),
      );

      const srcGrid = new Grid(src);
      const outGrid = new Grid(out);

      let maxError = 0;
      let sum = 0;
      let n = 0;
      for (let p = 0; p < out.length; p += 2 * QUERY_STRIDE) {
        const d = srcGrid.nearest(out[p]!, out[p + 1]!);
        if (d > maxError) maxError = d;
        sum += d;
        n++;
      }
      for (let p = 0; p < src.length; p += 2 * QUERY_STRIDE) {
        const d = outGrid.nearest(src[p]!, src[p + 1]!);
        if (d > maxError) maxError = d;
        sum += d;
        n++;
      }

      results.push({
        name,
        maxError,
        meanError: sum / n,
        maxErrorPct: (maxError / LUCIDE_VIEWBOX) * 100,
      });
    } catch (err) {
      results.push({
        name,
        maxError: Infinity,
        meanError: Infinity,
        maxErrorPct: Infinity,
        error: String(err),
      });
    }
    if (i % 25 === 0) {
      opts?.onProgress?.(i, names.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  svg.remove();
  opts?.onProgress?.(names.length, names.length);

  return {
    total: results.length,
    exact: results.filter((r) => !r.error && r.maxError < 0.005).length,
    errors: results.filter((r) => r.error),
    results: results.sort((a, b) => b.maxError - a.maxError),
  };
}
