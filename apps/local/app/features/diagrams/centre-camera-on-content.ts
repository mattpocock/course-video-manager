import type { Editor } from "tldraw";
import { getCenteringSettings } from "./diagram-centering-settings";

/**
 * Bring the whole page into view, centred within whatever space is left
 * after reserving room for the presenter's face-cam.
 *
 * Camera state is deliberately not persisted (ADR 0003), so loading a scene
 * leaves the camera wherever the last one left it — routinely pointing at
 * empty space, which reads as "the restore did nothing". Every load of a
 * scene calls this so the content is always where the author is looking.
 *
 * The face-cam itself is composited on top of the recording by external
 * software — this window has no visibility into it (ADR 0004) — so how much
 * room to leave for it is not something that can be computed, only tuned by
 * eye. `diagram-centering-settings` is that tuned, persisted answer: a
 * full-height strip of `faceCamWidth` screen pixels is reserved on the
 * right, and the diagram is fit-and-centred within what's left, inset by
 * `paddingX`/`paddingY` on every side. This is the one function that turns
 * those numbers into a camera move, so every automatic recentre (scene load,
 * restore, palette search, the manual recentre hotkey, and the debug panel's
 * live preview) agrees on where "centred" means.
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

  const { faceCamWidth, paddingX, paddingY } = getCenteringSettings();
  const viewport = editor.getViewportScreenBounds();

  // The rectangle (in screen pixels) the diagram is allowed to occupy: the
  // viewport minus the reserved face-cam strip on the right, inset by the
  // padding on every side.
  const safeWidth = Math.max(viewport.w - faceCamWidth - paddingX * 2, 1);
  const safeHeight = Math.max(viewport.h - paddingY * 2, 1);

  const { zoomSteps } = editor.getCameraOptions();
  const baseZoom = editor.getBaseZoom();
  const zoomMin = (zoomSteps?.[0] ?? 1) * baseZoom;
  const zoomMax = (zoomSteps?.[zoomSteps.length - 1] ?? 1) * baseZoom;

  const fitZoom = Math.min(safeWidth / bounds.w, safeHeight / bounds.h);
  const clampedZoom = Math.min(Math.max(fitZoom, zoomMin), zoomMax);
  const zoom = Math.min(baseZoom, clampedZoom);

  editor.setCamera(
    {
      x: -bounds.x + (paddingX + (safeWidth - bounds.w * zoom) / 2) / zoom,
      y: -bounds.y + (paddingY + (safeHeight - bounds.h * zoom) / 2) / zoom,
      z: zoom,
    },
    { immediate: true }
  );
}
