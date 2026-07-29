import { describe, it, expect } from "vitest";
import { createTLStore, defaultShapeUtils } from "tldraw";
import {
  ICON_SIZE_LADDER,
  buildIconContent,
  quantiseIconSize,
} from "./insert-onto-canvas";
import { CVM_SHAPE_UTILS } from "./cvm-shape-utils";

const schemaOf = () =>
  createTLStore({
    shapeUtils: [...defaultShapeUtils, ...CVM_SHAPE_UTILS],
  }).schema;

describe("buildIconContent", () => {
  it("survives the same migration pass putContentOntoCurrentPage runs", () => {
    // The icon path goes through `putContentOntoCurrentPage` rather than
    // `createShapes`, so the fragment has to be migratable — and a record
    // missing `typeName` is silently DROPPED there, not rejected.
    const schema = schemaOf();
    const content = buildIconContent({
      name: "database",
      size: 48,
      schema: schema.serialize(),
    });

    const result = schema.migrateStoreSnapshot({
      store: Object.fromEntries(content.shapes.map((s) => [s.id, s])),
      schema: content.schema,
    } as never);

    expect(result.type).toBe("success");
    const records = Object.values(
      (result as { value: Record<string, { typeName: string }> }).value
    );
    expect(records.map((r) => r.typeName)).toEqual(["shape"]);
  });

  it("passes the size, and deliberately not colour or dash", () => {
    // Leaving them out is what makes an inserted icon pick up the shape's
    // declared defaults and the style panel's next-shape styles.
    const content = buildIconContent({
      name: "database",
      size: 96,
      schema: schemaOf().serialize(),
    });
    const props = content.shapes[0]!.props as Record<string, unknown>;
    expect(props).toEqual({ name: "database", w: 96, h: 96 });
  });

  it("names its one shape as the root, so it lands at the viewport centre", () => {
    const content = buildIconContent({
      name: "database",
      size: 48,
      schema: schemaOf().serialize(),
    });
    expect(content.rootShapeIds).toEqual([content.shapes[0]!.id]);
    expect(content.assets).toEqual([]);
    expect(content.bindings).toEqual([]);
  });

  it("mints a fresh id every time, so inserting twice is two shapes", () => {
    const schema = schemaOf().serialize();
    const a = buildIconContent({ name: "database", size: 48, schema });
    const b = buildIconContent({ name: "database", size: 48, schema });
    expect(a.shapes[0]!.id).not.toBe(b.shapes[0]!.id);
  });
});

describe("quantiseIconSize", () => {
  it("inserts at 48 scene units at 100% zoom", () => {
    expect(quantiseIconSize(1)).toBe(48);
  });

  it("grows the shape as the author zooms out, so it stays 48 on screen", () => {
    expect(quantiseIconSize(0.5)).toBe(96);
    expect(quantiseIconSize(0.25)).toBe(192);
    expect(quantiseIconSize(0.125)).toBe(384);
  });

  it("shrinks the shape as the author zooms in", () => {
    expect(quantiseIconSize(2)).toBe(24);
    expect(quantiseIconSize(4)).toBe(24);
  });

  it("clamps at both ends of the ladder", () => {
    expect(quantiseIconSize(64)).toBe(24);
    expect(quantiseIconSize(0.001)).toBe(384);
  });

  it("gives icons inserted at similar zooms EXACTLY the same size", () => {
    // The whole point of quantising: a diagram must not accumulate near-miss
    // sizes like 137.4 next to 141.2.
    expect(quantiseIconSize(0.9)).toBe(quantiseIconSize(1.1));
    expect(quantiseIconSize(0.48)).toBe(quantiseIconSize(0.52));
  });

  it("only ever returns a rung of the ladder", () => {
    for (const zoom of [0.05, 0.3, 0.7, 1, 1.4, 3, 8]) {
      expect(ICON_SIZE_LADDER as readonly number[], `zoom ${zoom}`).toContain(
        quantiseIconSize(zoom)
      );
    }
  });

  it("falls back to 48 for a nonsensical zoom rather than dividing by it", () => {
    expect(quantiseIconSize(0)).toBe(48);
    expect(quantiseIconSize(-1)).toBe(48);
    expect(quantiseIconSize(Number.NaN)).toBe(48);
  });
});
