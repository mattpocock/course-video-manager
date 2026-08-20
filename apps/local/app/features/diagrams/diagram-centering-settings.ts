import { hasLocalStorage, useLocalStorage } from "@/hooks/use-local-storage";

/**
 * The presenter's face-cam is composited onto the recording by external
 * software (OBS) in the bottom-right corner of the screen — this window has
 * no visibility into it at all (ADR 0004: the diagram playground doubles as
 * the recording surface, but the camera itself lives outside tldraw/CVM).
 *
 * The first three of these four numbers are how `centreCameraOnContent`
 * knows how much room to leave for it: a full-height strip reserved on the
 * right, plus breathing room (padding) around the diagram within whatever's
 * left. There's no way to derive them — they depend on the physical size of
 * the author's camera bubble and how it feels once composited — so they're
 * tuned by eye via the debug panel (`diagram-centering-debug.tsx`) rather
 * than computed.
 *
 * `maxZoomPercent` is a different kind of number: with no ceiling of its
 * own, a small enough diagram would zoom in to fill the padded box no
 * matter how far that takes it — fine geometrically, but past some point it
 * just looks wrong (blown-up strokes, a page-filling icon). There's no way
 * to derive a "correct" value here either, so it's tuned the same way, and
 * the debug panel's live zoom readout is what it gets tuned against.
 *
 * Stored globally, not per-diagram: the camera setup is a property of the
 * recording rig, not of any one diagram.
 */
export const CENTERING_STORAGE_KEYS = {
  faceCamWidth: "diagram-centering:face-cam-width",
  paddingX: "diagram-centering:padding-x",
  paddingY: "diagram-centering:padding-y",
  maxZoomPercent: "diagram-centering:max-zoom-percent",
} as const;

export type CenteringSettingKey = keyof typeof CENTERING_STORAGE_KEYS;

/**
 * The spatial three default to zero so an untuned install behaves like the
 * old dead-centre-of-the-whole-viewport camera: no reserved strip, no
 * padding. `maxZoomPercent` can't default to zero the same way — that would
 * cap every diagram at no zoom at all — so it defaults to 300%, a starting
 * guess at "past here a small diagram looks blown up rather than fitted".
 * The debug panel is where all four actually get tuned.
 */
export const CENTERING_DEFAULTS: Record<CenteringSettingKey, number> = {
  faceCamWidth: 0,
  paddingX: 0,
  paddingY: 0,
  maxZoomPercent: 300,
};

export interface CenteringSettings {
  faceCamWidth: number;
  paddingX: number;
  paddingY: number;
  /** A cap on `centreCameraOnContent`'s fit zoom, as a percent of the
   * editor's own 100% (`baseZoom`) — see `CENTERING_DEFAULTS`. */
  maxZoomPercent: number;
}

function readStoredNumber(key: string, fallback: number): number {
  if (!hasLocalStorage()) return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read the current settings straight from `localStorage`. This is the one
 * place `centreCameraOnContent` (not a React component, called from plain
 * callbacks all over the diagram playground route) and the debug panel agree
 * on where the numbers live.
 */
export function getCenteringSettings(): CenteringSettings {
  return {
    faceCamWidth: readStoredNumber(
      CENTERING_STORAGE_KEYS.faceCamWidth,
      CENTERING_DEFAULTS.faceCamWidth
    ),
    paddingX: readStoredNumber(
      CENTERING_STORAGE_KEYS.paddingX,
      CENTERING_DEFAULTS.paddingX
    ),
    paddingY: readStoredNumber(
      CENTERING_STORAGE_KEYS.paddingY,
      CENTERING_DEFAULTS.paddingY
    ),
    maxZoomPercent: readStoredNumber(
      CENTERING_STORAGE_KEYS.maxZoomPercent,
      CENTERING_DEFAULTS.maxZoomPercent
    ),
  };
}

/** How far the diagram's safe area is inset from each edge of the viewport. */
export interface SafeAreaInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How much of the *window's* right edge the visible tldraw canvas does not
 * reach right now — e.g. because the Snapshot Timeline / Diagram Rail
 * sidebar is open (Focus Mode hides it, which is when this is zero).
 *
 * The face-cam is composited by OBS onto the window (ADR 0004), not onto
 * whatever fraction of it tldraw happens to be rendering into — so the strip
 * reserved for it has to be measured from the window's edge, and this is the
 * piece of that measurement `getViewportScreenBounds()` alone can't give,
 * because it only describes the canvas.
 */
export function getRightOffscreenWidth(
  viewport: { x: number; w: number },
  windowWidth: number
): number {
  return Math.max(windowWidth - (viewport.x + viewport.w), 0);
}

/**
 * The single definition of "the area the diagram is allowed to occupy":
 * padding on the left/top/bottom, and the reserved face-cam strip plus
 * padding on the right. `centreCameraOnContent` turns this into a camera
 * move; the debug panel's guide-box overlay renders it directly as CSS
 * insets — both read the same four numbers, so they can't drift apart.
 *
 * `rightOffscreenWidth` (see `getRightOffscreenWidth`) is subtracted from
 * `faceCamWidth` before padding is added, so a sidebar that already covers
 * part — or all — of the reserved strip doesn't make the canvas reserve it a
 * second time on top. That's what pins the diagram's centred position to the
 * same spot on the window whether the sidebar is open or Focus Mode has
 * hidden it: the strip's own position never moves, only how much of it the
 * *canvas* still has to leave clear does.
 *
 * Takes only the spatial three settings, not the full {@link CenteringSettings}
 * — `maxZoomPercent` has nothing to do with "the area the diagram occupies",
 * only with how far it gets zoomed once fitted into it, so callers that only
 * have those three (the debug panel's live guide-box render, this file's own
 * tests) don't need to fake a fourth field just to satisfy the type.
 */
export function getSafeAreaInsets(
  settings: Pick<CenteringSettings, "faceCamWidth" | "paddingX" | "paddingY">,
  rightOffscreenWidth = 0
): SafeAreaInsets {
  return {
    left: settings.paddingX,
    right:
      Math.max(settings.faceCamWidth - rightOffscreenWidth, 0) +
      settings.paddingX,
    top: settings.paddingY,
    bottom: settings.paddingY,
  };
}

/**
 * React form of a single setting, for the debug panel's number inputs. Reads
 * and writes the exact same `localStorage` key {@link getCenteringSettings}
 * reads, via the app's existing `useLocalStorage` hook.
 */
export function useCenteringSetting(
  key: CenteringSettingKey
): [number, (next: number) => void] {
  const [raw, setRaw] = useLocalStorage(
    CENTERING_STORAGE_KEYS[key],
    String(CENTERING_DEFAULTS[key])
  );
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? parsed : CENTERING_DEFAULTS[key];
  const setValue = (next: number) => setRaw(String(next));
  return [value, setValue];
}
