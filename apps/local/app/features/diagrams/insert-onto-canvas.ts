/**
 * The ONE path content takes onto the canvas.
 *
 * Icons do not take a `createShapes` shortcut: the icon path builds a one-shape
 * `TLContent` in memory and goes through the same `putContentOntoCurrentPage`.
 * It pays a trivial migration pass over a one-shape fragment; in exchange,
 * centring, selection, tool switching, undo marking and frame adoption exist in
 * exactly one place instead of two that drift.
 */

import { createShapeId } from "tldraw";
import type { Editor, SerializedSchema, TLContent } from "tldraw";

/**
 * Icons insert at the rung of this ladder closest to 48 screen px at the
 * current zoom (so 48 at 100%).
 *
 * Continuous `48 / zoom` was rejected: it scatters values like 137.4 through
 * the document, and ADR 0003 deliberately persists `document` while discarding
 * `session` because camera state "has no place in a Diagram's identity" —
 * continuous sizing smuggles it straight back in. Fixed-48 was rejected for the
 * opposite reason: at 25% zoom it inserts a 12px speck. Quantising keeps the
 * ergonomics while making icons inserted at similar zooms EXACTLY equal.
 */
export const ICON_SIZE_LADDER = [24, 48, 96, 192, 384] as const;

/** The on-screen size an inserted icon aims for, in CSS pixels. */
const TARGET_SCREEN_PX = 48;

export function quantiseIconSize(zoom: number): number {
  // A zoom of 0 or worse would make the target infinite; fall back to the rung
  // that means "48px at 100%".
  if (!Number.isFinite(zoom) || zoom <= 0) return TARGET_SCREEN_PX;

  const ideal = TARGET_SCREEN_PX / zoom;
  let best: number = ICON_SIZE_LADDER[0];
  let bestDistance = Infinity;
  for (const rung of ICON_SIZE_LADDER) {
    // Compare in log space: 24 and 96 are equally "far" from 48, which is what
    // a ladder of doublings means.
    const distance = Math.abs(Math.log(rung / ideal));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = rung;
    }
  }
  return best;
}

/**
 * A one-shape `TLContent` carrying a single icon.
 *
 * The icon path deliberately does NOT take a `createShapes` shortcut: it builds
 * a fragment and goes through the same `putContentOntoCurrentPage` a component
 * does. It pays a trivial migration pass over one shape; in exchange there is
 * exactly one insertion path.
 *
 * `size` is the only thing the CAMERA supplies, because the insert path is the
 * only place that can see the zoom. `color` is deliberately ABSENT:
 * `createShapes` merges a shape's declared prop defaults, then the style
 * panel's next-shape styles, under whatever props arrive — so leaving `color`
 * out is what makes an inserted icon pick up the current pen colour.
 *
 * `dash` is the exception, and it is passed for exactly that reason. tldraw's
 * next-shape `dash` defaults to `"draw"`, so an omitted `dash` does not fall
 * through to this shape's own `"solid"` default — it lands as tldraw's
 * hand-drawn stroke, which turns a crisp lucide glyph into a wobbled sketch of
 * one. Icons insert SOLID; the style panel can still switch an existing icon
 * afterwards.
 */
export function buildIconContent(opts: {
  name: string;
  size: number;
  schema: SerializedSchema;
}): TLContent {
  const id = createShapeId();
  return {
    shapes: [
      {
        id,
        // `putContentOntoCurrentPage` sorts records by `typeName`; without it
        // the shape is silently dropped and the insert does nothing.
        typeName: "shape",
        type: "cvm-icon",
        x: 0,
        y: 0,
        props: {
          name: opts.name,
          w: opts.size,
          h: opts.size,
          dash: "solid",
        },
      },
    ],
    bindings: [],
    assets: [],
    rootShapeIds: [id],
    schema: opts.schema,
  } as unknown as TLContent;
}

/**
 * Put content at the centre of what the author is currently looking at.
 *
 * The body, in order, and the order matters:
 *   1. force the `select` tool,
 *   2. mark a history stopping point, with nothing between it and the put,
 *   3. put, at an EXPLICIT point, with `select: true`.
 *
 * Returns whether the shapes actually LANDED. At `maxShapesPerPage`,
 * `putContentOntoCurrentPage` bails silently — it emits a `"max-shapes"` event
 * and returns, having inserted nothing. Callers close the palette on `true`
 * only, so the visible sequence stays "press Enter → palette gone → shapes
 * there" and never "palette gone → nothing happened".
 */
export function insertContentAtViewportCentre(
  editor: Editor,
  content: TLContent,
  opts: { historyLabel: string }
): boolean {
  // `SelectionForegroundOverlayUtil.isActive()` only renders the selection box
  // and handles while the editor is in a `select.*` state. Without this,
  // inserting while the DRAW tool is active — the likely case, since drawing is
  // the workflow this palette serves — leaves the shape selected in the store
  // but with no visible box and no handles, and the next drag scribbles over
  // it. `select: true` would be a lie.
  editor.setCurrentTool("select");

  const shapesBefore = editor.getCurrentPageShapeIds().size;

  // One mark immediately before the put, nothing between: one Cmd+Z then
  // removes an entire 40-shape component.
  editor.markHistoryStoppingPoint(opts.historyLabel);

  // `point` MUST be passed — mandatory, not stylistic.
  // `putContentOntoCurrentPage` does NOT default to viewport centre: with no
  // `point` it derives a paste parent from the CURRENT SELECTION (so content
  // would drop inside whatever group or frame happened to be selected) and uses
  // viewport centre only if no root shape already overlaps the viewport.
  //
  // Passing it also makes tldraw run `getShapeAtPoint` there, so a frame under
  // the viewport centre adopts the content as a child — matching what dragging
  // a shape into a frame does. Correct by default; nothing to suppress.
  //
  // Literal centre every time: no cascade offset, no nudge, no collision
  // "flash". Insert the same icon twice and the second lands exactly on the
  // first; you drag the top one off. The camera never moves.
  editor.putContentOntoCurrentPage(content, {
    point: editor.getViewportPageBounds().center,
    select: true,
    // `preserveIds` defaults to false, so every insert mints fresh ids and
    // remaps binding endpoints — inserting one component ten times is ten
    // independent shape sets. Spelled out because it is load-bearing.
    preserveIds: false,
  });

  return editor.getCurrentPageShapeIds().size > shapesBefore;
}
