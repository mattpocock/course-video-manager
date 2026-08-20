import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Editor } from "tldraw";
import { centreCameraOnContent } from "./centre-camera-on-content";
import { getCenteringSettings } from "./diagram-centering-settings";

vi.mock("./diagram-centering-settings", () => ({
  getCenteringSettings: vi.fn(),
}));

const mockGetCenteringSettings = vi.mocked(getCenteringSettings);

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
  beforeEach(() => {
    mockGetCenteringSettings.mockReturnValue({
      faceCamWidth: 0,
      paddingX: 0,
      paddingY: 0,
    });
  });

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
    mockGetCenteringSettings.mockReturnValue({
      faceCamWidth: 200,
      paddingX: 0,
      paddingY: 0,
    });
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
    mockGetCenteringSettings.mockReturnValue({
      faceCamWidth: 0,
      paddingX: 50,
      paddingY: 20,
    });
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
});
