import { describe, it, expect } from "vitest";
import type { Editor } from "tldraw";
import { centreCameraOnContent } from "./centre-camera-on-content";

/**
 * A stand-in for tldraw's `Editor` — a third-party boundary. Only the camera
 * call matters here, so the fake records it rather than simulating it.
 */
function fakeEditor(
  bounds: { x: number; y: number; w: number; h: number } | undefined
) {
  const calls: Array<{ bounds: unknown; opts: unknown }> = [];
  const editor = {
    getCurrentPageBounds: () => bounds,
    getBaseZoom: () => 1,
    zoomToBounds: (b: unknown, opts: unknown) => {
      calls.push({ bounds: b, opts });
    },
  } as unknown as Editor;
  return { editor, calls };
}

describe("centreCameraOnContent", () => {
  it("frames the page's content", () => {
    const { editor, calls } = fakeEditor({ x: 100, y: 200, w: 400, h: 300 });
    centreCameraOnContent(editor);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.bounds).toEqual({ x: 100, y: 200, w: 400, h: 300 });
  });

  it("never zooms in past 100%", () => {
    // `targetZoom` is a cap in tldraw, not a target: a big diagram still zooms
    // out to fit, but a single small shape does not fill the screen at 8x.
    const { editor, calls } = fakeEditor({ x: 0, y: 0, w: 10, h: 10 });
    centreCameraOnContent(editor);
    expect(calls[0]!.opts).toMatchObject({ targetZoom: 1 });
  });

  it("leaves the camera alone when the page is empty", () => {
    // Restoring an empty snapshot has nothing to centre on; moving the camera
    // to some arbitrary spot would just lose the author's place.
    const { editor, calls } = fakeEditor(undefined);
    centreCameraOnContent(editor);
    expect(calls).toHaveLength(0);
  });
});
