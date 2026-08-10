import { describe, it, expect } from "vitest";
import type { Element } from "hast";
import { getRemovableRange } from "./removable-block";

function element(
  tagName: string,
  offsets: { start: number; end: number } | undefined,
  children: Element["children"] = []
): Element {
  return {
    type: "element",
    tagName,
    properties: {},
    children,
    ...(offsets
      ? {
          position: {
            start: { line: 1, column: 1, offset: offsets.start },
            end: { line: 1, column: 1, offset: offsets.end },
          },
        }
      : {}),
  };
}

describe("getRemovableRange", () => {
  it("returns the source range of a block", () => {
    const node = element("p", { start: 9, end: 20 }, [
      { type: "text", value: "First para." },
    ]);

    expect(getRemovableRange(node, new Set())).toEqual({ start: 9, end: 20 });
  });

  it("returns undefined when the node is missing", () => {
    expect(getRemovableRange(undefined, new Set())).toBeUndefined();
  });

  it("returns undefined when the node carries no source position", () => {
    expect(
      getRemovableRange(element("p", undefined), new Set())
    ).toBeUndefined();
  });

  it("returns undefined for a block that only wraps a custom component", () => {
    const node = element("p", { start: 0, end: 42 }, [
      element("choosescreenshot", { start: 0, end: 42 }),
    ]);

    expect(
      getRemovableRange(node, new Set(["choosescreenshot"]))
    ).toBeUndefined();
  });

  it("still returns a range when the custom tag is not overridden", () => {
    const node = element("p", { start: 0, end: 42 }, [
      element("choosescreenshot", { start: 0, end: 42 }),
    ]);

    expect(getRemovableRange(node, new Set())).toEqual({ start: 0, end: 42 });
  });

  it("returns undefined when a custom component sits alongside text", () => {
    const node = element("p", { start: 0, end: 50 }, [
      { type: "text", value: "See " },
      element("choosescreenshot", { start: 4, end: 46 }),
    ]);

    expect(
      getRemovableRange(node, new Set(["choosescreenshot"]))
    ).toBeUndefined();
  });

  it("returns a range for a block whose children are ordinary inline elements", () => {
    const node = element("h2", { start: 5, end: 18 }, [
      element("em", { start: 8, end: 14 }),
    ]);

    expect(getRemovableRange(node, new Set(["choosescreenshot"]))).toEqual({
      start: 5,
      end: 18,
    });
  });
});
