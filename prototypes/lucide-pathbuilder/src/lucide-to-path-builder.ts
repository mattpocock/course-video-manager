/**
 * PROTOTYPE — throwaway. lucide `IconNode` -> tldraw `PathBuilder`.
 *
 * This is the whole proposed transpiler contract, in one function:
 *
 *   iconNodeToPathBuilder(node, size) -> PathBuilder   // in shape space, 0..size
 *
 * lucide icons are authored in a 24x24 viewBox with stroke-width 2, round caps
 * and round joins, fill: none. We emit geometry only; stroke width / colour /
 * caps are the renderer's business (see icon-shape-util.tsx).
 */

import { PathBuilder } from "tldraw";
import { parsePathD } from "./parse-path-d";

export type IconNode = [tag: string, attrs: Record<string, string | number>][];

export const LUCIDE_VIEWBOX = 24;
export const LUCIDE_STROKE_WIDTH = 2;

const num = (v: string | number | undefined, fallback = 0) =>
  v === undefined ? fallback : typeof v === "number" ? v : parseFloat(v);

/**
 * A subpath is opened with `moveTo`. `geometry` on the move opts is how a
 * subpath declares itself filled — lucide uses that for the handful of solid
 * dots (`fill="currentColor"` on a `<circle>`).
 */
function moveOpts(isFilled: boolean) {
  return isFilled ? { geometry: { isFilled: true } } : undefined;
}

export function iconNodeToPathBuilder(node: IconNode, size: number) {
  const s = size / LUCIDE_VIEWBOX;
  const p = new PathBuilder();

  for (const [tag, attrs] of node) {
    const isFilled = attrs.fill === "currentColor";

    switch (tag) {
      case "path":
        emitPathD(p, String(attrs.d), s, isFilled);
        break;

      case "circle":
        emitEllipse(
          p,
          num(attrs.cx) * s,
          num(attrs.cy) * s,
          num(attrs.r) * s,
          num(attrs.r) * s,
          isFilled,
        );
        break;

      case "ellipse":
        emitEllipse(
          p,
          num(attrs.cx) * s,
          num(attrs.cy) * s,
          num(attrs.rx) * s,
          num(attrs.ry) * s,
          isFilled,
        );
        break;

      case "rect": {
        // SVG's `auto` rule: a missing rx takes ry's value and vice versa.
        // lucide relies on this — e.g. arrow-down-0-1 ships `ry="2"` with no rx.
        const rxAttr = attrs.rx === undefined ? undefined : num(attrs.rx);
        const ryAttr = attrs.ry === undefined ? undefined : num(attrs.ry);
        const rx = rxAttr ?? ryAttr ?? 0;
        const ry = ryAttr ?? rxAttr ?? 0;
        emitRect(
          p,
          num(attrs.x) * s,
          num(attrs.y) * s,
          num(attrs.width) * s,
          num(attrs.height) * s,
          rx * s,
          ry * s,
          isFilled,
        );
        break;
      }

      case "line":
        p.moveTo(num(attrs.x1) * s, num(attrs.y1) * s).lineTo(
          num(attrs.x2) * s,
          num(attrs.y2) * s,
        );
        break;

      case "polyline":
      case "polygon": {
        const pts = String(attrs.points)
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        p.moveTo(pts[0]! * s, pts[1]! * s, moveOpts(isFilled));
        for (let i = 2; i < pts.length; i += 2)
          p.lineTo(pts[i]! * s, pts[i + 1]! * s);
        if (tag === "polygon") p.close();
        break;
      }

      default:
        throw new Error(`unsupported lucide primitive <${tag}>`);
    }
  }

  return p;
}

function emitPathD(
  p: PathBuilder,
  d: string,
  s: number,
  isFilled: boolean,
): void {
  const segs = parsePathD(d);

  // PathBuilder throws if a command arrives without an open subpath, and
  // `close()` clears the open subpath. Track the subpath start so we can
  // re-open it if the path continues after a Z.
  let subStart: { x: number; y: number } | null = null;
  let open = false;
  const ensureOpen = () => {
    if (!open && subStart) {
      p.moveTo(subStart.x, subStart.y, moveOpts(isFilled));
      open = true;
    }
  };

  for (const seg of segs) {
    switch (seg.c) {
      case "M":
        subStart = { x: seg.x * s, y: seg.y * s };
        p.moveTo(subStart.x, subStart.y, moveOpts(isFilled));
        open = true;
        break;
      case "L":
        ensureOpen();
        p.lineTo(seg.x * s, seg.y * s);
        break;
      case "C":
        ensureOpen();
        // NOTE: PathBuilder takes the ENDPOINT FIRST, the inverse of SVG's
        // `C cp1x cp1y cp2x cp2y x y`. Easiest possible way to get this wrong.
        p.cubicBezierTo(
          seg.x * s,
          seg.y * s,
          seg.x1 * s,
          seg.y1 * s,
          seg.x2 * s,
          seg.y2 * s,
        );
        break;
      case "A":
        ensureOpen();
        // Flags are booleans and rotation is RADIANS here; SVG gives 0/1 and degrees.
        // Uniform scale only — rx/ry scale exactly because the icon shape keeps
        // its aspect ratio locked. (17 icons carry non-zero x-axis rotation,
        // which a non-uniform scale would shear incorrectly.)
        p.arcTo(
          seg.rx * s,
          seg.ry * s,
          seg.laf,
          seg.sf,
          (seg.rot * Math.PI) / 180,
          seg.x * s,
          seg.y * s,
        );
        break;
      case "Z":
        if (open) {
          p.close();
          open = false;
        }
        break;
    }
  }
}

/** An ellipse is two 180° arcs, the same shape tldraw's own geo ellipse uses. */
function emitEllipse(
  p: PathBuilder,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  isFilled: boolean,
) {
  p.moveTo(cx - rx, cy, moveOpts(isFilled))
    .arcTo(rx, ry, false, true, 0, cx + rx, cy)
    .arcTo(rx, ry, false, true, 0, cx - rx, cy)
    .close();
}

/** Rounded rect. 374 of lucide's 382 rects have an `rx`, so the corners matter. */
function emitRect(
  p: PathBuilder,
  x: number,
  y: number,
  w: number,
  h: number,
  rxIn: number,
  ryIn: number,
  isFilled: boolean,
) {
  const rx = Math.min(Math.abs(rxIn), w / 2);
  const ry = Math.min(Math.abs(ryIn), h / 2);

  if (rx === 0 || ry === 0) {
    p.moveTo(x, y, moveOpts(isFilled))
      .lineTo(x + w, y)
      .lineTo(x + w, y + h)
      .lineTo(x, y + h)
      .close();
    return;
  }

  p.moveTo(x + rx, y, moveOpts(isFilled))
    .lineTo(x + w - rx, y)
    .arcTo(rx, ry, false, true, 0, x + w, y + ry)
    .lineTo(x + w, y + h - ry)
    .arcTo(rx, ry, false, true, 0, x + w - rx, y + h)
    .lineTo(x + rx, y + h)
    .arcTo(rx, ry, false, true, 0, x, y + h - ry)
    .lineTo(x, y + ry)
    .arcTo(rx, ry, false, true, 0, x + rx, y)
    .close();
}

/** The source SVG, for side-by-side comparison. */
export function iconNodeToSvgMarkup(node: IconNode, size: number) {
  const inner = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${a} />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
