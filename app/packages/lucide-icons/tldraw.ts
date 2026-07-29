// Entry point (public) — the TLDRAW half of the lucide-icons package.
//
// Kept separate from `./index` so the server-side `extract-scene-text` path can
// resolve icon names without pulling tldraw into the server bundle.
//
// Everything here sits DOWNSTREAM of the frozen icon table, so a transpiler fix
// is never scene-affecting.

import { getIconNode } from "./index";
import {
  LUCIDE_STROKE_WIDTH,
  LUCIDE_VIEWBOX,
  iconNodeToPathBuilder,
} from "./lib/to-path-builder";
import type { PathBuilder } from "tldraw";

export { LUCIDE_STROKE_WIDTH, LUCIDE_VIEWBOX, iconNodeToPathBuilder };

/**
 * The transpiled geometry for a name at a given size, or `undefined` if this
 * build has never heard of the name. Callers render a placeholder in that case
 * rather than throwing — an unknown name must not cost the document.
 */
export function getIconPathBuilder(
  name: string,
  size: number
): PathBuilder | undefined {
  const node = getIconNode(name);
  return node ? iconNodeToPathBuilder(node, size) : undefined;
}

/**
 * Stroke width is PROPORTIONAL: `2 x size / 24`. That reproduces lucide exactly
 * at every size, where tldraw's flat `DefaultSizeStyle` ladder (2/3.5/5/10)
 * renders a 400px icon as a spidery hairline and a 24px one as a blob.
 *
 * Under strokes-only hit testing this does usability work as well as fidelity
 * work: the stroke IS the hit target.
 */
export function iconStrokeWidth(size: number): number {
  return (LUCIDE_STROKE_WIDTH * size) / LUCIDE_VIEWBOX;
}
