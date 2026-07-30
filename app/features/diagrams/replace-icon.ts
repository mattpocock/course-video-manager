/**
 * Swapping the glyph of an icon that is ALREADY on the canvas.
 *
 * Deliberately NOT a case of the insert path. Inserting the new glyph and
 * deleting the old one loses everything the shape carries beyond its name — the
 * size it was resized to, where it sits, its rotation, its colour and dash, the
 * frame or group it belongs to, its z-order, and every arrow bound to it.
 * Rebuilding that by hand is exactly the work this exists to remove.
 *
 * So replacement writes ONE prop and leaves the rest of the record untouched,
 * which is what makes the bindings survive by construction rather than by
 * being copied across.
 */

import type { Editor, TLShape, TLShapeId } from "tldraw";
import { CVM_ICON_SHAPE_TYPE, type CvmIconShape } from "./cvm-icon-shape";

/**
 * The icon a "Replace icon" row would act on, or `null` if there isn't one.
 *
 * Exactly one shape, and it must be an icon. A mixed selection, or two icons,
 * has no unambiguous answer — and per the palette's "absent, not disabled"
 * rule the row simply does not appear, rather than appearing and picking one.
 *
 * Pure, and separate from the editor, because this is the decision that
 * silently goes wrong: CVM has no browser test infrastructure, so behaviour
 * only gets tested by being a plain function over plain shapes.
 */
export function singleSelectedIcon(shapes: TLShape[]): CvmIconShape | null {
  if (shapes.length !== 1) return null;
  const [shape] = shapes;
  if (!shape || shape.type !== CVM_ICON_SHAPE_TYPE) return null;
  return shape as CvmIconShape;
}

/**
 * Point an existing icon at a different glyph, in place.
 *
 * Returns false when the shape is no longer there — the selection is read when
 * the palette OPENS, and while the modal makes the canvas unreachable in
 * between, the id is still only a claim about the store. The caller keeps the
 * palette up and says so rather than closing on a write that never happened.
 */
export function replaceIconName(
  editor: Editor,
  id: TLShapeId,
  name: string
): boolean {
  const shape = editor.getShape(id);
  if (!shape || shape.type !== CVM_ICON_SHAPE_TYPE) return false;

  // One mark immediately before the write, nothing between: one Cmd+Z puts the
  // old glyph back and nothing else with it.
  editor.markHistoryStoppingPoint("replace icon");

  // A PARTIAL `props`, and that is the entire mechanism. `updateShape` merges
  // it over the shape's existing props, so `w`, `h`, `color` and `dash` are
  // preserved by not being mentioned — restating them here with anything other
  // than their current values is the only way this can go wrong.
  editor.updateShape({ id, type: CVM_ICON_SHAPE_TYPE, props: { name } });
  return true;
}
