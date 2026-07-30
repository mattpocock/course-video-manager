import { describe, it, expect } from "vitest";
import { createShapeId } from "tldraw";
import type { Editor, TLShape, TLShapePartial } from "tldraw";
import type { CvmIconShape } from "./cvm-icon-shape";
import { replaceIconName, singleSelectedIcon } from "./replace-icon";

function icon(props: Partial<CvmIconShape["props"]> = {}): CvmIconShape {
  return {
    id: createShapeId(),
    typeName: "shape",
    type: "cvm-icon",
    x: 120,
    y: -40,
    rotation: 0.25,
    parentId: "page:page",
    index: "a1",
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      name: "server",
      w: 96,
      h: 96,
      color: "blue",
      dash: "solid",
      ...props,
    },
  } as unknown as CvmIconShape;
}

function notAnIcon(): TLShape {
  return { ...icon(), type: "geo" } as unknown as TLShape;
}

describe("singleSelectedIcon", () => {
  it("finds the one selected icon", () => {
    const shape = icon();
    expect(singleSelectedIcon([shape])).toBe(shape);
  });

  it("finds nothing in an empty selection", () => {
    expect(singleSelectedIcon([])).toBeNull();
  });

  it("finds nothing when the one selected shape is not an icon", () => {
    expect(singleSelectedIcon([notAnIcon()])).toBeNull();
  });

  it("finds nothing in a selection of two icons", () => {
    // Which one would it replace? The row is ABSENT rather than guessing.
    expect(singleSelectedIcon([icon(), icon()])).toBeNull();
  });

  it("finds nothing when the icon is selected alongside something else", () => {
    expect(singleSelectedIcon([icon(), notAnIcon()])).toBeNull();
  });
});

/** Records what reached tldraw, in order. */
function fakeEditor(present: CvmIconShape | TLShape | null) {
  const updates: TLShapePartial[] = [];
  const order: string[] = [];
  const editor = {
    getShape: (id: string) =>
      present && present.id === id ? present : undefined,
    markHistoryStoppingPoint: () => order.push("mark"),
    updateShape: (partial: TLShapePartial) => {
      order.push("update");
      updates.push(partial);
    },
  } as unknown as Editor;
  return { editor, updates, order };
}

describe("replaceIconName", () => {
  it("writes the name and NOTHING else", () => {
    // The whole point: the shape keeps the size it was resized to, where it
    // sits, its rotation, its colour and dash, its parent frame, and every
    // arrow bound to it. Respecifying any of those here would silently reset
    // one of them.
    const shape = icon({ name: "server", w: 96, h: 96, color: "blue" });
    const { editor, updates } = fakeEditor(shape);

    expect(replaceIconName(editor, shape.id, "database")).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe(shape.id);
    expect(updates[0]!.type).toBe("cvm-icon");
    expect(updates[0]!.props).toEqual({ name: "database" });
  });

  it("marks a history stopping point BEFORE the write", () => {
    // Otherwise one Cmd+Z after a replace lands somewhere else entirely.
    const shape = icon();
    const { editor, order } = fakeEditor(shape);
    replaceIconName(editor, shape.id, "database");
    expect(order).toEqual(["mark", "update"]);
  });

  it("does nothing when the shape has gone", () => {
    // The selection is read when the palette OPENS; a modal makes the canvas
    // unreachable in between, but the id is still only a claim about the store.
    const shape = icon();
    const { editor, updates, order } = fakeEditor(null);
    expect(replaceIconName(editor, shape.id, "database")).toBe(false);
    expect(updates).toEqual([]);
    expect(order).toEqual([]);
  });

  it("does nothing when that id is no longer an icon", () => {
    const shape = notAnIcon();
    const { editor, updates } = fakeEditor(shape);
    expect(replaceIconName(editor, shape.id, "database")).toBe(false);
    expect(updates).toEqual([]);
  });
});
