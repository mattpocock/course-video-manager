import { describe, it, expect } from "vitest";
import { ICON_NAMES, getIconNode, type IconNode } from "../index";
import {
  LUCIDE_STROKE_WIDTH,
  LUCIDE_VIEWBOX,
  getIconPathBuilder,
  iconNodeToPathBuilder,
  iconStrokeWidth,
} from "../tldraw";

/** Pull the numbers out of an emitted `d` string, for exactness assertions. */
function numbers(d: string): number[] {
  return (d.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
}

const at = (node: IconNode, size = LUCIDE_VIEWBOX) =>
  iconNodeToPathBuilder(node, size).toD();

describe("scale", () => {
  it("applies one uniform scale of size/24 to every coordinate", () => {
    const d = at([["line", { x1: 0, y1: 0, x2: 24, y2: 12 }]], 48);
    expect(numbers(d)).toEqual([0, 0, 48, 24]);
  });

  it("is the identity at the lucide viewBox size", () => {
    const d = at([["line", { x1: 3, y1: 6, x2: 21, y2: 18 }]]);
    expect(numbers(d)).toEqual([3, 6, 21, 18]);
  });
});

describe("path commands", () => {
  it("folds H and V into lines", () => {
    const d = at([["path", { d: "M2 2H10V20" }]]);
    expect(numbers(d)).toEqual([2, 2, 10, 2, 10, 20]);
  });

  it("absolutises relative commands", () => {
    const d = at([["path", { d: "M2 2l3 4" }]]);
    expect(numbers(d)).toEqual([2, 2, 5, 6]);
  });

  it("elevates Q to a cubic exactly, by the two-thirds formula", () => {
    // P0 (0,0), Q (6,12), P2 (12,0):
    //   C1 = P0 + 2/3 (Q - P0) = (4, 8)
    //   C2 = P2 + 2/3 (Q - P2) = (8, 8)
    const d = at([["path", { d: "M0 0Q6 12 12 0" }]]);
    expect(numbers(d)).toEqual([0, 0, 4, 8, 8, 8, 12, 0]);
  });

  it("elevates a relative q the same way", () => {
    const d = at([["path", { d: "M0 0q6 12 12 0" }]]);
    expect(numbers(d)).toEqual([0, 0, 4, 8, 8, 8, 12, 0]);
  });

  it("resolves T by reflecting the previous quadratic control point", () => {
    // After Q with control (6,12) ending at (12,0), T's implied control is the
    // reflection of (6,12) about (12,0) = (18,-12). Elevating that quadratic
    // over P0 (12,0) -> P2 (24,0) gives C1 (16,-8), C2 (20,-8).
    const d = at([["path", { d: "M0 0Q6 12 12 0T24 0" }]]);
    expect(numbers(d).slice(8)).toEqual([16, -8, 20, -8, 24, 0]);
  });

  it("resolves S by reflecting the previous cubic control point", () => {
    // Previous cubic's second control point is (8,8); reflected about the
    // endpoint (12,0) that is (16,-8).
    const d = at([["path", { d: "M0 0C4 8 8 8 12 0S20 -8 24 0" }]]);
    expect(numbers(d).slice(8, 10)).toEqual([16, -8]);
  });

  it("re-opens a subpath with a moveTo when the path continues after Z", () => {
    // close() clears the open subpath; a naive transpiler asserts here.
    expect(() => at([["path", { d: "M2 2H8V8Z L12 12" }]])).not.toThrow();
    const d = at([["path", { d: "M2 2H8V8Z L12 12" }]]);
    expect(d.match(/M/g)?.length).toBe(2);
  });

  it("treats an implicit repeat of M as L", () => {
    const d = at([["path", { d: "M1 1 5 5" }]]);
    expect(numbers(d)).toEqual([1, 1, 5, 5]);
  });
});

describe("non-path primitives", () => {
  // PathBuilder flattens every arc to cubics on the way out, so the emitted `d`
  // carries no `A` and no `Z`: arcs are counted as curves, and closedness is
  // read off the geometry.
  const curves = (d: string) => (d.match(/C/g) ?? []).length;
  const isClosed = (node: IconNode) =>
    iconNodeToPathBuilder(node, LUCIDE_VIEWBOX).toGeometry().isClosed;

  it("turns a circle into two 180-degree arcs and closes it", () => {
    expect(curves(at([["circle", { cx: 12, cy: 12, r: 10 }]]))).toBe(4);
    expect(isClosed([["circle", { cx: 12, cy: 12, r: 10 }]])).toBe(true);
  });

  it("turns an ellipse into two arcs with distinct radii", () => {
    const node: IconNode = [["ellipse", { cx: 12, cy: 12, rx: 10, ry: 4 }]];
    expect(curves(at(node))).toBe(4);
    expect(isClosed(node)).toBe(true);
  });

  it("gives a rect four rounded corners when it has a radius", () => {
    const d = at([["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }]]);
    expect(curves(d)).toBe(4);
  });

  it("rounds a rect that carries only ry — SVG's `auto` rule, not zero", () => {
    // The one real bug the spike found: `arrow-up-0-1` and friends ship
    // `ry="2"` with no `rx` and were 7.1% wrong at 384px while `rx ?? 0` gave
    // them square corners.
    const d = at([["rect", { x: 4, y: 4, width: 16, height: 16, ry: 2 }]]);
    expect(curves(d)).toBe(4);
  });

  it("rounds a rect that carries only rx, symmetrically", () => {
    const onlyRx = at([["rect", { x: 4, y: 4, width: 16, height: 16, rx: 2 }]]);
    const onlyRy = at([["rect", { x: 4, y: 4, width: 16, height: 16, ry: 2 }]]);
    expect(onlyRy).toBe(onlyRx);
  });

  it("leaves a rect with no radius square", () => {
    const d = at([["rect", { x: 3, y: 3, width: 18, height: 18 }]]);
    expect(curves(d)).toBe(0);
  });

  it("leaves a polyline open and closes a polygon", () => {
    expect(isClosed([["polyline", { points: "2 2 8 8 14 2" }]])).toBe(false);
    expect(isClosed([["polygon", { points: "2 2 8 8 14 2" }]])).toBe(true);
  });

  it("leaves a line open", () => {
    expect(isClosed([["line", { x1: 1, y1: 1, x2: 9, y2: 9 }]])).toBe(false);
  });

  it("throws on a primitive lucide does not use", () => {
    expect(() => at([["text", { x: 1, y: 1 }]] as unknown as IconNode)).toThrow(
      /unsupported lucide primitive/
    );
  });
});

describe("filled subpaths", () => {
  it("emits a filled pass for fill=currentColor and nothing for the rest", () => {
    // 16 circles across 7 icons are solid dots and pupils rather than outlines.
    const filled = iconNodeToPathBuilder(
      [["circle", { cx: 12, cy: 12, r: 2, fill: "currentColor" }]],
      LUCIDE_VIEWBOX
    );
    expect(filled.toD({ onlyFilled: true })).not.toBe("");

    const hollow = iconNodeToPathBuilder(
      [["circle", { cx: 12, cy: 12, r: 2 }]],
      LUCIDE_VIEWBOX
    );
    expect(hollow.toD({ onlyFilled: true })).toBe("");
  });

  it("carries a real filled icon's dot through", () => {
    const node = getIconNode("chart-scatter")!;
    const filled = iconNodeToPathBuilder(node, 96).toD({ onlyFilled: true });
    expect(filled.length).toBeGreaterThan(0);
  });
});

describe("stroke width", () => {
  it("is proportional: 2 x size / 24", () => {
    expect(iconStrokeWidth(24)).toBe(LUCIDE_STROKE_WIDTH);
    expect(iconStrokeWidth(48)).toBe(4);
    expect(iconStrokeWidth(384)).toBe(32);
  });
});

describe("getIconPathBuilder", () => {
  it("resolves a name against the frozen table", () => {
    expect(getIconPathBuilder("database", 96)?.toD()).toBeTruthy();
  });

  it("returns undefined for an unknown name rather than throwing", () => {
    expect(getIconPathBuilder("definitely-not-an-icon", 96)).toBeUndefined();
  });
});

describe("the total-set sweep", () => {
  it("transpiles every name in the frozen table with zero throws", () => {
    const failures: string[] = [];
    for (const name of ICON_NAMES) {
      for (const size of [24, 96, 384]) {
        try {
          const d = iconNodeToPathBuilder(getIconNode(name)!, size).toD();
          if (!d) failures.push(`${name}@${size}: empty`);
        } catch (e) {
          failures.push(`${name}@${size}: ${(e as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("lets save-off overflow its viewBox rather than special-casing it", () => {
    const d = iconNodeToPathBuilder(
      getIconNode("save-off")!,
      LUCIDE_VIEWBOX
    ).toD();
    expect(Math.max(...numbers(d))).toBeGreaterThan(LUCIDE_VIEWBOX);
  });
});
