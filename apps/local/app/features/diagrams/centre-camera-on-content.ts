import type { Editor } from "tldraw";
import {
  getCenteringSettings,
  getRightOffscreenWidth,
  getSafeAreaInsets,
} from "./diagram-centering-settings";

/**
 * Bring the whole page into view, centred within whatever space is left
 * after reserving room for the presenter's face-cam.
 *
 * Camera state is deliberately not persisted (ADR 0003), so loading a scene
 * leaves the camera wherever the last one left it — routinely pointing at
 * empty space, which reads as "the restore did nothing". Every load of a
 * scene calls this so the content is always where the author is looking.
 *
 * This window doubles as the literal screen-recording surface (ADR 0004),
 * and the presenter's face-cam is composited on top of that recording by
 * external software — invisible to tldraw/CVM entirely. So how much room to
 * leave for it is not something that can be computed, only tuned by eye.
 * `diagram-centering-settings` is that tuned, persisted answer: a
 * full-height strip of `faceCamWidth` screen pixels is reserved on the
 * right, and the diagram is fit-and-centred within what's left, inset by
 * `paddingX`/`paddingY` on every side. This is the one function that turns
 * those numbers into a camera move, so every automatic recentre (scene load,
 * restore, palette search, the manual recentre hotkey, and the debug panel's
 * live preview) agrees on where "centred" means.
 *
 * The strip is pinned to the *window's* right edge, not the tldraw
 * viewport's: `getViewportScreenBounds()` shrinks whenever the Snapshot
 * Timeline / Diagram Rail sidebar is showing, and reserving `faceCamWidth`
 * from ITS edge would double-reserve — once for the sidebar, again for the
 * strip — so the diagram's "centred" position would jump every time the
 * sidebar opened or closed, or Focus Mode toggled it away. Subtracting
 * `getRightOffscreenWidth` before insetting keeps that position fixed to the
 * window regardless.
 *
 * `targetZoom` is a *cap*, not a target: a large diagram still zooms out to
 * fit, while a single small shape is centred at 100% instead of being blown
 * up past it. This mirrors tldraw's own `zoomToBounds`, whose fit-and-clamp
 * math this reimplements by hand — `zoomToBounds` only fits into the full
 * viewport, centred, and can't target an off-centre sub-region of it.
 */
export function centreCameraOnContent(editor: Editor): void {
  const bounds = editor.getCurrentPageBounds();
  if (!bounds) return;

  const settings = getCenteringSettings();
  const viewport = editor.getViewportScreenBounds();
  // No `window` in SSR/tests — falls back to the viewport's own width, i.e.
  // "nothing is off-canvas", the same as this function's behaviour before
  // the sidebar was accounted for.
  const windowWidth =
    typeof window !== "undefined" ? window.innerWidth : viewport.x + viewport.w;
  const insets = getSafeAreaInsets(
    settings,
    getRightOffscreenWidth(viewport, windowWidth)
  );

  // The rectangle (in screen pixels) the diagram is allowed to occupy: the
  // viewport, inset on every side by `insets` — the same insets the debug
  // panel's guide-box overlay renders directly as CSS.
  const safeWidth = Math.max(viewport.w - insets.left - insets.right, 1);
  const safeHeight = Math.max(viewport.h - insets.top - insets.bottom, 1);

  const { zoomSteps } = editor.getCameraOptions();
  const baseZoom = editor.getBaseZoom();
  const zoomMin = (zoomSteps?.[0] ?? 1) * baseZoom;
  const zoomMax = (zoomSteps?.[zoomSteps.length - 1] ?? 1) * baseZoom;

  const fitZoom = Math.min(safeWidth / bounds.w, safeHeight / bounds.h);
  const clampedZoom = Math.min(Math.max(fitZoom, zoomMin), zoomMax);
  const zoom = Math.min(baseZoom, clampedZoom);

  editor.setCamera(
    {
      x: -bounds.x + (insets.left + (safeWidth - bounds.w * zoom) / 2) / zoom,
      y: -bounds.y + (insets.top + (safeHeight - bounds.h * zoom) / 2) / zoom,
      z: zoom,
    },
    { immediate: true }
  );
}
