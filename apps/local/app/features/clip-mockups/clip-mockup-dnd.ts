/**
 * Pure drop-resolution for Clip Mockup drag-and-drop.
 *
 * The Video's Animatic is ONE sortable list — a Clip Mockup's frame lives
 * under its Video's `lineageId`, so unlike a Beat it can never be dragged into
 * a sibling Video. That is the whole difference from {@link computeBeatDrop}:
 * no target Video, one container, otherwise the same rules and the same
 * `before` anchor that `cvm clip-mockup move --before` hands to
 * `ClipMockupOperationsService.moveClipMockup`.
 *
 * Framework-free on purpose, exactly like `beat-dnd.ts`: the drag arithmetic
 * is the part that is easy to get wrong, so it is unit tested without jsdom
 * and without dnd-kit.
 */

/** The dnd-kit id of the Animatic's drop zone (dropping here appends). */
export const CLIP_MOCKUP_CONTAINER_ID = "clip-mockup-container";

export type ClipMockupDrop = {
  clipMockupId: string;
  /** Place the moved Clip Mockup before this one; `null` appends to the end. */
  beforeClipMockupId: string | null;
};

/**
 * Resolve a drag to a concrete move, or `null` when it is a no-op (dropped on
 * itself, dropped nowhere, or dropped exactly where it already sits).
 *
 * Rule: dropping onto a Clip Mockup inserts *before* it; dropping onto the
 * container appends to the end of the Animatic.
 */
export function computeClipMockupDrop({
  activeId,
  overId,
  clipMockupIds,
}: {
  activeId: string;
  overId: string | null;
  clipMockupIds: string[];
}): ClipMockupDrop | null {
  if (!overId || overId === activeId) return null;
  if (!clipMockupIds.includes(activeId)) return null;

  let beforeClipMockupId: string | null;
  if (overId === CLIP_MOCKUP_CONTAINER_ID) {
    beforeClipMockupId = null;
  } else {
    if (!clipMockupIds.includes(overId)) return null;
    beforeClipMockupId = overId;
  }

  // dnd-kit's SortableContext shifts the rows visually during a drag but
  // reports `overId` as the row the pointer crossed. Dragging DOWN past row X
  // means "put it after X", not "before X", so the anchor becomes X's next
  // sibling in the list the moved row has already left.
  if (beforeClipMockupId !== null) {
    const activeIdx = clipMockupIds.indexOf(activeId);
    const overIdx = clipMockupIds.indexOf(beforeClipMockupId);
    if (activeIdx < overIdx) {
      const remaining = clipMockupIds.filter((id) => id !== activeId);
      const next = remaining[remaining.indexOf(beforeClipMockupId) + 1];
      beforeClipMockupId = next ?? null;
    }
  }

  // Already there: the row immediately after the dragged one IS the anchor.
  const afterActiveId =
    clipMockupIds[clipMockupIds.indexOf(activeId) + 1] ?? null;
  if (afterActiveId === beforeClipMockupId) return null;

  return { clipMockupId: activeId, beforeClipMockupId };
}
