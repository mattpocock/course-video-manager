import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react/pure";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Editor, TLShapeId } from "tldraw";
import { DiagramEditor } from "@/features/diagrams/diagram-editor";
import { PlaygroundStatusProvider } from "@/features/diagrams/playground-status";
import {
  attachFaceHistory,
  type ThumbnailEditorHistory,
} from "./thumbnail-face-history";
import type { ThumbnailFace } from "./thumbnail-face";

/**
 * The face rides in the editor document's meta, so its moves, nudges and
 * retakes undo with the drawing. tldraw's own document-settings update skips
 * history, which is why this needs a real editor.
 */

const status = { reportError: () => {}, reportSuccess: () => {} };

let editor: Editor;

// ONE editor for the file, never unmounted (`/pure` has no auto-cleanup):
// tldraw loads fonts in the background, and an editor disposed mid-load
// throws from inside tldraw.
beforeAll(async () => {
  editor = await new Promise<Editor>((resolve) => {
    const router = createMemoryRouter(
      [
        {
          id: "root",
          path: "/",
          loader: () => ({ tldrawLicenseKey: undefined }),
          HydrateFallback: () => null,
          element: (
            <PlaygroundStatusProvider value={status}>
              <div style={{ position: "fixed", inset: 0 }}>
                <DiagramEditor onMount={resolve} paletteHandlers={null} />
              </div>
            </PlaygroundStatusProvider>
          ),
        },
      ],
      {
        hydrationData: {
          loaderData: { root: { tldrawLicenseKey: undefined } },
        },
      }
    );
    render(<RouterProvider router={router} />);
  });
});

const face = (
  photo: string,
  horizontalPosition: number,
  cutout: string | null = `${photo}-cutout`
): ThumbnailFace => ({ photo, cutout, horizontalPosition });

let history: ThumbnailEditorHistory;
let restored: ThumbnailFace[];
let dispose: () => void;

beforeEach(() => {
  dispose?.();
  editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
  restored = [];
  ({ history, dispose } = attachFaceHistory(editor, face("photo", 50), (f) =>
    restored.push(f)
  ));
  editor.clearHistory();
});

/** A drawing edit, as tldraw records one: its own undo step. */
const draw = (id: string) => {
  editor.markHistoryStoppingPoint(`draw ${id}`);
  editor.createShape({
    id: `shape:${id}` as TLShapeId,
    type: "geo",
    x: 0,
    y: 0,
  });
};

/** tldraw's store listeners run a frame after the change. */
const nextFrame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

const shapes = () =>
  [...editor.getCurrentPageShapeIds()].map((id) => id.replace("shape:", ""));

describe("one undo history for the face and the drawing", () => {
  it("undoes a face move, a nudge and a retake, interleaved with drawing edits", async () => {
    draw("a");
    history.recordFace(face("photo", 70), "new-step"); // a move
    draw("b");
    history.recordFace(face("photo", 72.5), "new-step"); // a nudge
    history.recordFace(face("retake", 72.5), "new-step"); // a retake

    history.undo();
    await nextFrame();
    expect(restored.at(-1)).toEqual(face("photo", 72.5));
    history.undo();
    await nextFrame();
    expect(restored.at(-1)).toEqual(face("photo", 70));
    expect(shapes()).toEqual(["a", "b"]);
    history.undo();
    await nextFrame();
    expect(shapes()).toEqual(["a"]);
    history.undo();
    await nextFrame();
    expect(restored.at(-1)).toEqual(face("photo", 50));
    history.undo();
    await nextFrame();
    expect(shapes()).toEqual([]);

    history.redo();
    history.redo();
    await nextFrame();
    expect(restored.at(-1)).toEqual(face("photo", 70));
  });

  it("one slider drag undoes in one step", async () => {
    history.recordFace(face("photo", 55), "new-step");
    history.recordFace(face("photo", 60), "same-step");
    history.recordFace(face("photo", 65), "same-step");

    history.undo();
    await nextFrame();

    expect(restored).toEqual([face("photo", 50)]);
  });

  it("does not report back the face it was told to record", async () => {
    history.recordFace(face("photo", 70), "new-step");
    draw("a");
    await nextFrame();

    expect(restored).toEqual([]);
  });

  it("a silent write is not undone by undoing the step before it", async () => {
    // A first capture: the face moves while its background is removed.
    history.recordFace(face("photo", 70, null), "new-step");
    history.recordFace(face("photo", 70, "cutout"), "silent");

    history.undo();
    await nextFrame();

    expect(restored).toEqual([]);
  });
});
