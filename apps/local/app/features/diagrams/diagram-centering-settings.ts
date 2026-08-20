import { hasLocalStorage, useLocalStorage } from "@/hooks/use-local-storage";

/**
 * The presenter's face-cam is composited onto the recording by external
 * software (OBS) in the bottom-right corner of the screen — this window has
 * no visibility into it at all (ADR 0004: the diagram playground doubles as
 * the recording surface, but the camera itself lives outside tldraw/CVM).
 *
 * These three numbers are how `centreCameraOnContent` knows how much room to
 * leave for it: a full-height strip reserved on the right, plus breathing
 * room (padding) around the diagram within whatever's left. There's no way
 * to derive them — they depend on the physical size of the author's camera
 * bubble and how it feels once composited — so they're tuned by eye via the
 * debug panel (`diagram-centering-debug.tsx`) rather than computed.
 *
 * Stored globally, not per-diagram: the camera setup is a property of the
 * recording rig, not of any one diagram.
 */
export const CENTERING_STORAGE_KEYS = {
  faceCamWidth: "diagram-centering:face-cam-width",
  paddingX: "diagram-centering:padding-x",
  paddingY: "diagram-centering:padding-y",
} as const;

export type CenteringSettingKey = keyof typeof CENTERING_STORAGE_KEYS;

/**
 * Defaults to zero so an untuned install behaves like the old
 * dead-centre-of-the-whole-viewport camera: no reserved strip, no padding.
 * The debug panel is where these actually become non-zero.
 */
export const CENTERING_DEFAULTS: Record<CenteringSettingKey, number> = {
  faceCamWidth: 0,
  paddingX: 0,
  paddingY: 0,
};

export interface CenteringSettings {
  faceCamWidth: number;
  paddingX: number;
  paddingY: number;
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
 * The single definition of "the area the diagram is allowed to occupy":
 * padding on the left/top/bottom, and the reserved face-cam strip plus
 * padding on the right. `centreCameraOnContent` turns this into a camera
 * move; the debug panel's guide-box overlay renders it directly as CSS
 * insets — both read the same four numbers, so they can't drift apart.
 */
export function getSafeAreaInsets(settings: CenteringSettings): SafeAreaInsets {
  return {
    left: settings.paddingX,
    right: settings.faceCamWidth + settings.paddingX,
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
