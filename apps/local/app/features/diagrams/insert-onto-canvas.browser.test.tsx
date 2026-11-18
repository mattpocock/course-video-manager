import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react/pure";
import { getSnapshot, Tldraw, type Editor, type TLShape } from "tldraw";
import "tldraw/tldraw.css";
import {
  applySimpleDiagram,
  parseSimpleDiagram,
  type Scene,
} from "@cvm/core/lib/simple-diagram/index";
import { ICON_NAMES } from "@cvm/lucide-icons";
import { CVM_SHAPE_UTILS } from "./cvm-shape-utils";
import { buildSceneContent, insertDrawingAsGroup } from "./insert-onto-canvas";

/**
 * "Insert diagram" puts a whole stored drawing (a Diagram's head or a
 * DiagramSnapshot's scene) onto the canvas. Scaling text and strokes is
 * tldraw behaviour, so these run against the real editor.
 */

const DRAWING = {
  shapes: [
    { type: "box", id: "agent", x: 0, y: 0, w: 200, h: 100 },
    { type: "text", id: "label", x: 0, y: 140, text: "a label" },
    { type: "ellipse", id: "tools", x: 400, y: 0, w: 200, h: 100 },
    { type: "arrow", id: "call", from: "agent", to: "tools", text: "call" },
  ],
};

const sceneOf = (json: unknown): Scene => {
  const parsed = parseSimpleDiagram(json, new Set(ICON_NAMES));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const applied = applySimpleDiagram(null, parsed.diagram);
  if (!applied.ok) throw new Error(applied.errors.join("\n"));
  return applied.scene;
};

const content = (scene: unknown) => {
  const built = buildSceneContent(scene);
  if (!built) throw new Error("no content");
  return built;
};

const scaleOf = (shape: TLShape) =>
  (shape.props as { scale?: number }).scale ?? null;

/** Every shape on the page, top-level or nested, by its type. */
const shapesOfType = (type: string) =>
  [...editor.getCurrentPageShapeIds()]
    .map((id) => editor.getShape(id)!)
    .filter((s) => s.type === type);

let editor: Editor;

// ONE editor for the file, never unmounted (`/pure` has no auto-cleanup):
// tldraw loads fonts in the background, and an editor disposed mid-load
// throws from inside tldraw.
beforeAll(async () => {
  editor = await new Promise<Editor>((resolve) => {
    render(
      <div style={{ position: "fixed", inset: 0 }}>
        <Tldraw hideUi shapeUtils={CVM_SHAPE_UTILS} onMount={resolve} />
      </div>
    );
  });
});

beforeEach(() => {
  editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
  editor.clearHistory();
  editor.setCamera({ x: 0, y: 0, z: 1 });
});

describe("inserting a whole drawing", () => {
  it("lands as one selected group, the only new shape at the top level", () => {
    const landed = insertDrawingAsGroup(editor, content(sceneOf(DRAWING)));

    expect(landed).toBe(true);
    const roots = editor.getSortedChildIdsForParent(editor.getCurrentPageId());
    expect(roots).toHaveLength(1);
    expect(editor.getShape(roots[0]!)?.type).toBe("group");
    expect(editor.getSelectedShapeIds()).toEqual(roots);
    expect(editor.getSortedChildIdsForParent(roots[0]!)).toHaveLength(4);
  });

  it("is scaled to fit the view, centred on it", () => {
    insertDrawingAsGroup(editor, content(sceneOf(DRAWING)));

    const viewport = editor.getViewportPageBounds();
    const bounds = editor.getSelectionPageBounds()!;
    // Fills 80% of the view along its tighter side, and fits in the other.
    const fill = Math.max(bounds.w / viewport.w, bounds.h / viewport.h);
    expect(fill).toBeCloseTo(0.8, 1);
    expect(bounds.w).toBeLessThanOrEqual(viewport.w);
    expect(bounds.h).toBeLessThanOrEqual(viewport.h);
    expect(bounds.center.x).toBeCloseTo(viewport.center.x, 0);
    expect(bounds.center.y).toBeCloseTo(viewport.center.y, 0);
  });

  it("scales text, labels and strokes with the boxes", () => {
    insertDrawingAsGroup(editor, content(sceneOf(DRAWING)));

    const box = shapesOfType("geo").find(
      (s) => (s.props as { geo: string }).geo === "rectangle"
    )!;
    const factor = (box.props as { w: number }).w / 200;
    expect(factor).not.toBeCloseTo(1, 1);

    expect(scaleOf(box)).toBeCloseTo(factor, 5);
    expect(scaleOf(shapesOfType("arrow")[0]!)).toBeCloseTo(factor, 5);
    expect(scaleOf(shapesOfType("text")[0]!)).toBeCloseTo(factor, 5);
  });

  it("scales a group's children inside the drawing too", () => {
    // A stored drawing that already holds a group.
    editor.createShapes([
      { type: "geo", x: 0, y: 0, props: { w: 100, h: 100 } },
      { type: "geo", x: 200, y: 0, props: { w: 100, h: 100 } },
    ]);
    editor.groupShapes([...editor.getCurrentPageShapeIds()]);
    const scene = getSnapshot(editor.store).document;
    editor.deleteShapes([...editor.getCurrentPageShapeIds()]);

    insertDrawingAsGroup(editor, content(scene));

    const boxes = shapesOfType("geo");
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      const factor = (box.props as { w: number }).w / 100;
      expect(factor).not.toBeCloseTo(1, 1);
      expect(scaleOf(box)).toBeCloseTo(factor, 5);
    }
  });

  it("is removed whole by one undo", () => {
    insertDrawingAsGroup(editor, content(sceneOf(DRAWING)));
    expect(editor.getCurrentPageShapeIds().size).toBeGreaterThan(0);

    editor.undo();

    expect(editor.getCurrentPageShapeIds().size).toBe(0);
  });
});

describe("buildSceneContent", () => {
  it("has nothing to insert from a drawing with no shapes", () => {
    const empty = getSnapshot(editor.store).document;
    expect(buildSceneContent(empty)).toBeNull();
    expect(buildSceneContent(null)).toBeNull();
  });
});
