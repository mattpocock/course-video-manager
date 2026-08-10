import type { Editor } from "tldraw";

/**
 * Bring the whole page into view, centred, without zooming past 100%.
 *
 * Camera state is deliberately not persisted (ADR 0003), so loading a scene
 * leaves the camera wherever the last one left it — routinely pointing at empty
 * space, which reads as "the restore did nothing". Every load of a scene calls
 * this so the content is always where the author is looking.
 *
 * `targetZoom` is a *cap* in tldraw, not a target: a large diagram still zooms
 * out to fit, while a single small shape is centred at 100% instead of being
 * blown up to the 8x zoom limit. This mirrors tldraw's own behaviour when it
 * follows a deep link.
 */
export function centreCameraOnContent(editor: Editor): void {
  const bounds = editor.getCurrentPageBounds();
  if (!bounds) return;
  editor.zoomToBounds(bounds, {
    targetZoom: editor.getBaseZoom(),
    immediate: true,
  });
}
