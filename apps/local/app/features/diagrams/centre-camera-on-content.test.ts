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
    // zoom = min(1000/400, 800/300) = 2.5 — width is the constraining axis,
    // so it fills exactly; height has 50px of slack split above and below.
    // x = -100 + (0 + (1000 - 400*2.5)/2)/2.5 = -100
    // y = -200 + (0 + (800 - 300*2.5)/2)/2.5 = -190
    expect(calls[0]!.point).toMatchObject({ x: -100, y: -190, z: 2.5 });
    expect(calls[0]!.opts).toMatchObject({ immediate: true });
  });

  it("reserves a full-height strip on the right for the face-cam", () => {
    seedSettings({ faceCamWidth: 200 });
    const { editor, calls } = fakeEditor({
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    centreCameraOnContent(editor);
    // safeWidth = 1000 - 200 = 800, safeHeight = 800 (full height, unaffected)
    // fit zoom = min(800/100, 800/100) = 8 — both axes fill exactly.
    // x = -0 + (0 + (800 - 100*8)/2)/8 = 0
    // y = -0 + (0 + (800 - 100*8)/2)/8 = 0
    expect(calls[0]!.point).toMatchObject({ x: 0, y: 0, z: 8 });
  });

  it("insets the diagram by paddingX/paddingY on every side — the fitted edge lands exactly on the padding line", () => {
    seedSettings({ paddingX: 100, paddingY: 100 });
    const { editor, calls } = fakeEditor({
      bounds: { x: 0, y: 0, w: 200, h: 100 },
    });
    centreCameraOnContent(editor);
    // safeWidth = 1000 - 200 = 800, safeHeight = 800 - 200 = 600
    // fit zoom = min(800/200, 600/100) = 4 — width is the constraining axis.
    // x = -0 + (100 + (800 - 200*4)/2)/4 = 25 — and 25 * 4 = 100 = paddingX
    //     exactly: the left edge of the content lands ON the padding line,
    //     not floating somewhere inside it (the bug this test used to hide,
    //     back when zoom capped at 100% and left a diagram this small just
    //     sitting in the middle of a much bigger gap).
    // y = -0 + (100 + (600 - 100*4)/2)/4 = 50
    expect(calls[0]!.point).toMatchObject({ x: 25, y: 50, z: 4 });
  });

  it("zooms in past 100% to fill the safe area, clamped only by the camera's own zoom ceiling", () => {
    // No cap at the editor's "100%" (`baseZoom`) any more: a diagram this
    // small would ask for 80x (min(1000/10, 800/10)) to fill the frame, which
    // is past even this editor's own zoom ceiling (zoomSteps top * baseZoom =
    // 8 * 2 = 16) — so the ceiling is what actually stops it, not 100%.
    const { editor, calls } = fakeEditor({
      bounds: { x: 0, y: 0, w: 10, h: 10 },
      baseZoom: 2,
    });
    centreCameraOnContent(editor);
    expect(calls[0]!.point).toMatchObject({ z: 16 });
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
      // fit zoom = min(800/100, 800/100) = 8 — both axes fill exactly.
      // x = -0 + (0 + (800 - 100*8)/2)/8 = 0
      expect(withSidebarCalls[0]!.point).toMatchObject({ x: 0, y: 0, z: 8 });

      // No sidebar (Focus Mode, or Playground Home): same window, same
      // content, the canvas now spans it and reserves the strip itself.
      const { editor: noSidebar, calls: noSidebarCalls } = fakeEditor({
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        viewport: { x: 0, y: 0, w: 1000, h: 800 },
      });
      withWindowWidth(1000, () => centreCameraOnContent(noSidebar));
      // safeWidth = 1000 - 200 = 800, safeHeight = 800 — identical to above.
      expect(noSidebarCalls[0]!.point).toMatchObject({ x: 0, y: 0, z: 8 });
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
      // fit zoom = min(800/100, 800/100) = 8 — both axes fill exactly.
      // x = -0 + (0 + (800 - 100*8)/2)/8 = 0
      expect(calls[0]!.point).toMatchObject({ x: 0, y: 0, z: 8 });
    });

    it("falls back to reserving the full strip from the viewport's own edge without a window (SSR/tests)", () => {
      // No `window` stubbed — every other test in this file runs this way,
      // and it used to be the only way this function ran at all.
      seedSettings({ faceCamWidth: 200 });
      const { editor, calls } = fakeEditor({
        bounds: { x: 0, y: 0, w: 75, h: 100 },
        viewport: { x: 0, y: 0, w: 800, h: 800 },
      });
      centreCameraOnContent(editor);
      // safeWidth = 800 - 200 = 600, safeHeight = 800
      // fit zoom = min(600/75, 800/100) = 8 — both axes fill exactly.
      // x = -0 + (0 + (600 - 75*8)/2)/8 = 0
      expect(calls[0]!.point).toMatchObject({ x: 0, y: 0, z: 8 });
    });
  });
});
