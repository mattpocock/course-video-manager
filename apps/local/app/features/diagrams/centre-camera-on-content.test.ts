import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Editor } from "tldraw";
import { centreCameraOnContent } from "./centre-camera-on-content";
import {
  CENTERING_STORAGE_KEYS,
  type CenteringSettings,
} from "./diagram-centering-settings";

/**
 * `localStorage` is a system boundary, so it is the one thing here worth
 * faking — `getCenteringSettings` runs for real, through the settings
 * module's own reads, the same way `recent-icons.test.ts` fakes it for the
 * palette rather than mocking the module that wraps it.
 */
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function seedSettings(settings: Partial<CenteringSettings>) {
  for (const [key, value] of Object.entries(settings)) {
    store.set(
      CENTERING_STORAGE_KEYS[key as keyof typeof CENTERING_STORAGE_KEYS],
      String(value)
    );
  }
}

/**
 * `window` is a system boundary too, same rule as `localStorage` above —
 * stubbed the same way `recent-icons.test.ts` stubs it, and always torn back
 * down so a test that forgets to call this still runs in the no-window
 * environment every other test in this file relies on.
 */
function withWindowWidth<T>(innerWidth: number, fn: () => T): T {
  (globalThis as { window?: unknown }).window = { innerWidth };
  try {
    return fn();
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

/**
 * A stand-in for tldraw's `Editor` — a third-party boundary. Only the camera
 * call matters here, so the fake records it rather than simulating it.
 */
function fakeEditor(opts: {
  bounds: { x: number; y: number; w: number; h: number } | undefined;
  viewport?: { x: number; y: number; w: number; h: number };
  baseZoom?: number;
  zoomSteps?: number[];
}) {
  const {
    bounds,
    viewport = { x: 0, y: 0, w: 1000, h: 800 },
    baseZoom = 1,
    zoomSteps = [0.1, 8],
  } = opts;
  const calls: Array<{ point: unknown; opts: unknown }> = [];
  const editor = {
    getCurrentPageBounds: () => bounds,
    getViewportScreenBounds: () => viewport,
    getBaseZoom: () => baseZoom,
    getCameraOptions: () => ({ zoomSteps }),
    setCamera: (point: unknown, cameraOpts: unknown) => {
      calls.push({ point, opts: cameraOpts });
    },
  } as unknown as Editor;
  return { editor, calls };
}

describe("centreCameraOnContent", () => {
  it("frames the page's content dead-centre when no face-cam room is reserved", () => {
    const { editor, calls } = fakeEditor({
      bounds: { x: 100, y: 200, w: 400, h: 300 },
    });
    centreCameraOnContent(editor);
    expect(calls).toHaveLength(1);
    // zoom = min(1000/400, 800/300) = 2.5, capped at baseZoom 1
    // x = -100 + (0 + (1000 - 400*1)/2)/1 = 200
    // y = -200 + (0 + (800 - 300*1)/2)/1 = 50
    expect(calls[0]!.point).toMatchObject({ x: 200, y: 50, z: 1 });
    expect(calls[0]!.opts).toMatchObject({ immediate: true });
  });

  it("reserves a full-height strip on the right for the face-cam", () => {
    seedSettings({ faceCamWidth: 200 });
    const { editor, calls } = fakeEditor({
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    centreCameraOnContent(editor);
    // safeWidth = 1000 - 200 = 800, safeHeight = 800 (full height, unaffected)
    // fit zoom = min(800/100, 800/100) = 8, capped at baseZoom 1
    // x = -0 + (0 + (800 - 100*1)/2)/1 = 350
    // y = -0 + (0 + (800 - 100*1)/2)/1 = 350
    expect(calls[0]!.point).toMatchObject({ x: 350, y: 350, z: 1 });
  });

  it("insets the diagram by paddingX/paddingY on every side", () => {
    seedSettings({ paddingX: 50, paddingY: 20 });
    const { editor, calls } = fakeEditor({
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    centreCameraOnContent(editor);
    // safeWidth = 1000 - 100 = 900, safeHeight = 800 - 40 = 760
    // fit zoom = min(900/100, 760/100) = 7.6, capped at baseZoom 1
    // x = -0 + (50 + (900 - 100*1)/2)/1 = 450
    // y = -0 + (20 + (760 - 100*1)/2)/1 = 350
    expect(calls[0]!.point).toMatchObject({ x: 450, y: 350, z: 1 });
  });

  it("never zooms in past the editor's own 100%", () => {
    // `targetZoom` is a cap in tldraw, not a target: a big diagram still zooms
    // out to fit, but a single small shape does not fill the screen at 8x. The
    // cap is whatever this editor calls 100% — not a hardcoded 1, which camera
    // constraints can move.
    const { editor, calls } = fakeEditor({
      bounds: { x: 0, y: 0, w: 10, h: 10 },
      baseZoom: 2,
    });
    centreCameraOnContent(editor);
    expect(calls[0]!.point).toMatchObject({ z: 2 });
  });

  it("leaves the camera alone when the page is empty", () => {
    // Restoring an empty snapshot has nothing to centre on; moving the camera
    // to some arbitrary spot would just lose the author's place.
    const { editor, calls } = fakeEditor({ bounds: undefined });
    centreCameraOnContent(editor);
    expect(calls).toHaveLength(0);
  });

  describe("sidebar independence", () => {
    it("lands the diagram in exactly the same spot whether or not the Snapshot Timeline / Diagram Rail sidebar is eating the reserved strip", () => {
      // The sidebar (800px of canvas left, out of a 1000px window) happens to
      // be exactly as wide as the reserved face-cam strip: the canvas can't
      // reach any of the strip, so nothing extra needs reserving from ITS
      // edge — the sidebar is already doing that job.
      seedSettings({ faceCamWidth: 200 });
      const { editor: withSidebar, calls: withSidebarCalls } = fakeEditor({
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        viewport: { x: 0, y: 0, w: 800, h: 800 },
      });
      withWindowWidth(1000, () => centreCameraOnContent(withSidebar));
      // safeWidth = 800 - 0 = 800, safeHeight = 800
      // fit zoom = min(800/100, 800/100) = 8, capped at baseZoom 1
      // x = -0 + (0 + (800 - 100)/2)/1 = 350
      expect(withSidebarCalls[0]!.point).toMatchObject({
        x: 350,
        y: 350,
        z: 1,
      });

      // No sidebar (Focus Mode, or Playground Home): same window, same
      // content, the canvas now spans it and reserves the strip itself.
      const { editor: noSidebar, calls: noSidebarCalls } = fakeEditor({
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        viewport: { x: 0, y: 0, w: 1000, h: 800 },
      });
      withWindowWidth(1000, () => centreCameraOnContent(noSidebar));
      // safeWidth = 1000 - 200 = 800, safeHeight = 800 — identical to above.
      expect(noSidebarCalls[0]!.point).toMatchObject({ x: 350, y: 350, z: 1 });
    });

    it("still reserves whatever the sidebar doesn't already cover", () => {
      // The sidebar only eats 100px of a 200px strip — the canvas has to
      // leave the other 100px clear itself.
      seedSettings({ faceCamWidth: 200 });
      const { editor, calls } = fakeEditor({
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        viewport: { x: 0, y: 0, w: 900, h: 800 },
      });
      withWindowWidth(1000, () => centreCameraOnContent(editor));
      // right inset = max(200 - 100, 0) = 100
      // safeWidth = 900 - 100 = 800, safeHeight = 800
      // fit zoom = min(800/100, 800/100) = 8, capped at baseZoom 1
      // x = -0 + (0 + (800 - 100)/2)/1 = 350
      expect(calls[0]!.point).toMatchObject({ x: 350, y: 350, z: 1 });
    });

    it("falls back to reserving the full strip from the viewport's own edge without a window (SSR/tests)", () => {
      // No `window` stubbed — every other test in this file runs this way,
      // and it used to be the only way this function ran at all.
      seedSettings({ faceCamWidth: 200 });
      const { editor, calls } = fakeEditor({
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        viewport: { x: 0, y: 0, w: 800, h: 800 },
      });
      centreCameraOnContent(editor);
      // safeWidth = 800 - 200 = 600, safeHeight = 800
      // fit zoom = min(600/100, 800/100) = 6, capped at baseZoom 1
      // x = -0 + (0 + (600 - 100)/2)/1 = 250
      expect(calls[0]!.point).toMatchObject({ x: 250, y: 350, z: 1 });
    });
  });
});
