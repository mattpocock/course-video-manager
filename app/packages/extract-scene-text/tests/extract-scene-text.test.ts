import { describe, it, expect } from "vitest";
import { extractSceneText, flattenRichText } from "../index";

// Helper: build a ProseMirror doc from paragraphs of text nodes
function doc(
  ...paragraphs: Array<Array<{ text: string; marks?: unknown[] }> | null>
) {
  return {
    type: "doc",
    content: paragraphs.map((nodes) =>
      nodes
        ? {
            type: "paragraph",
            content: nodes.map((n) => ({ type: "text", ...n })),
          }
        : { type: "paragraph" }
    ),
  };
}

// Helper: build a minimal scene with shapes in the store
function scene(
  shapes: Record<string, { type: string; props: Record<string, unknown> }>
) {
  const store: Record<string, unknown> = {};
  for (const [id, shape] of Object.entries(shapes)) {
    store[`shape:${id}`] = {
      typeName: "shape",
      id: `shape:${id}`,
      type: shape.type,
      props: shape.props,
    };
  }
  return { store, schema: { schemaVersion: 2 } };
}

describe("flattenRichText", () => {
  it("extracts plain text from a single paragraph", () => {
    const rt = doc([{ text: "Hello world" }]);
    expect(flattenRichText(rt)).toBe("Hello world");
  });

  it("rejoins inline runs without spurious separators (bold text)", () => {
    // "Hello **world**" in ProseMirror = two text nodes in one paragraph
    const rt = doc([
      { text: "Hello " },
      { text: "world", marks: [{ type: "bold" }] },
    ]);
    expect(flattenRichText(rt)).toBe("Hello world");
  });

  it("inserts whitespace at block boundaries", () => {
    const rt = doc(
      [{ text: "First paragraph" }],
      [{ text: "Second paragraph" }]
    );
    expect(flattenRichText(rt)).toBe("First paragraph Second paragraph");
  });

  it("handles empty doc (no content)", () => {
    expect(flattenRichText({ type: "doc", content: [] })).toBe("");
  });

  it("handles empty paragraphs (blank lines)", () => {
    const rt = doc([{ text: "Before" }], null, [{ text: "After" }]);
    expect(flattenRichText(rt)).toBe("Before After");
  });

  it("ignores non-text leaves", () => {
    const rt = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "visible" },
            { type: "hardBreak" },
            { type: "mention", attrs: { id: "user1" } },
          ],
        },
      ],
    };
    expect(flattenRichText(rt)).toBe("visible");
  });

  it("collapses whitespace and trims", () => {
    const rt = doc([{ text: "  hello   world  " }]);
    expect(flattenRichText(rt)).toBe("hello world");
  });

  it("returns empty string for null/undefined/non-object input", () => {
    expect(flattenRichText(null)).toBe("");
    expect(flattenRichText(undefined)).toBe("");
    expect(flattenRichText(42)).toBe("");
    expect(flattenRichText("string")).toBe("");
  });

  it("returns empty string when doc has no content array", () => {
    expect(flattenRichText({ type: "doc" })).toBe("");
  });

  it("ignores marks and attrs on text leaves", () => {
    const rt = doc([
      { text: "plain" },
      { text: " italic", marks: [{ type: "italic" }] },
      { text: " bold-italic", marks: [{ type: "bold" }, { type: "italic" }] },
    ]);
    expect(flattenRichText(rt)).toBe("plain italic bold-italic");
  });
});

describe("extractSceneText", () => {
  it("extracts text from a text shape via richText", () => {
    const s = scene({
      a: { type: "text", props: { richText: doc([{ text: "Hello" }]) } },
    });
    expect(extractSceneText(s)).toBe("Hello");
  });

  it("extracts labels from a geo shape via richText", () => {
    const s = scene({
      a: { type: "geo", props: { richText: doc([{ text: "Rectangle" }]) } },
    });
    expect(extractSceneText(s)).toBe("Rectangle");
  });

  it("extracts text from a note shape via richText", () => {
    const s = scene({
      a: { type: "note", props: { richText: doc([{ text: "Sticky" }]) } },
    });
    expect(extractSceneText(s)).toBe("Sticky");
  });

  it("extracts text from an arrow shape via richText", () => {
    const s = scene({
      a: { type: "arrow", props: { richText: doc([{ text: "connects" }]) } },
    });
    expect(extractSceneText(s)).toBe("connects");
  });

  it("extracts frame name from frame shape (props.name)", () => {
    const s = scene({
      a: { type: "frame", props: { name: "My Frame" } },
    });
    expect(extractSceneText(s)).toBe("My Frame");
  });

  it("falls back to props.text when richText is absent (legacy)", () => {
    const s = scene({
      a: { type: "text", props: { text: "legacy text" } },
    });
    expect(extractSceneText(s)).toBe("legacy text");
  });

  it("joins multiple shapes with a single space", () => {
    const s = scene({
      a: { type: "text", props: { richText: doc([{ text: "Hello" }]) } },
      b: { type: "geo", props: { richText: doc([{ text: "World" }]) } },
    });
    const result = extractSceneText(s);
    // Both words should be present separated by a space
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result.split(/\s+/).length).toBe(2);
  });

  it("excludes image shapes (no altText extraction in v1)", () => {
    const s = scene({
      a: { type: "image", props: { altText: "a picture" } },
    });
    expect(extractSceneText(s)).toBe("");
  });

  it("excludes video shapes", () => {
    const s = scene({
      a: { type: "video", props: { altText: "a video" } },
    });
    expect(extractSceneText(s)).toBe("");
  });

  it("excludes bookmark shapes (URLs)", () => {
    const s = scene({
      a: { type: "bookmark", props: { url: "https://example.com" } },
    });
    expect(extractSceneText(s)).toBe("");
  });

  it("excludes embed shapes", () => {
    const s = scene({
      a: { type: "embed", props: { url: "https://youtube.com/watch" } },
    });
    expect(extractSceneText(s)).toBe("");
  });

  it("excludes no-text shapes: draw, line, highlight, group", () => {
    const s = scene({
      a: { type: "draw", props: {} },
      b: { type: "line", props: {} },
      c: { type: "highlight", props: {} },
      d: { type: "group", props: {} },
    });
    expect(extractSceneText(s)).toBe("");
  });

  it("skips non-shape records (bindings, assets, pages)", () => {
    const s = {
      store: {
        "binding:1": { typeName: "binding", id: "binding:1", type: "arrow" },
        "asset:1": { typeName: "asset", id: "asset:1", type: "image" },
        "page:1": { typeName: "page", id: "page:1" },
        "shape:a": {
          typeName: "shape",
          id: "shape:a",
          type: "text",
          props: { richText: doc([{ text: "visible" }]) },
        },
      },
      schema: { schemaVersion: 2 },
    };
    expect(extractSceneText(s)).toBe("visible");
  });

  // --- Total-tolerance tests ---

  it("returns empty string for unknown shape type", () => {
    const s = scene({
      a: {
        type: "custom-unknown",
        props: { richText: doc([{ text: "nope" }]) },
      },
    });
    expect(extractSceneText(s)).toBe("");
  });

  it("returns empty string for a text shape with missing props", () => {
    const s = {
      store: {
        "shape:a": { typeName: "shape", id: "shape:a", type: "text" },
      },
      schema: { schemaVersion: 2 },
    };
    expect(extractSceneText(s)).toBe("");
  });

  it("returns empty string for malformed richText (not a valid doc)", () => {
    const s = scene({
      a: { type: "text", props: { richText: "not an object" } },
    });
    expect(extractSceneText(s)).toBe("");
  });

  it("never throws on completely invalid input", () => {
    expect(extractSceneText(null)).toBe("");
    expect(extractSceneText(undefined)).toBe("");
    expect(extractSceneText(42)).toBe("");
    expect(extractSceneText("string")).toBe("");
    expect(extractSceneText({})).toBe("");
    expect(extractSceneText({ store: null })).toBe("");
    expect(extractSceneText({ store: "invalid" })).toBe("");
  });

  it("handles a scene with an empty store", () => {
    expect(extractSceneText({ store: {}, schema: { schemaVersion: 2 } })).toBe(
      ""
    );
  });

  it("prefers richText over props.text when both exist", () => {
    const s = scene({
      a: {
        type: "text",
        props: {
          richText: doc([{ text: "from richText" }]),
          text: "from props.text",
        },
      },
    });
    expect(extractSceneText(s)).toBe("from richText");
  });

  it("handles mixed shapes — extractable and non-extractable", () => {
    const s = scene({
      txt: { type: "text", props: { richText: doc([{ text: "typed" }]) } },
      drw: { type: "draw", props: {} },
      frm: { type: "frame", props: { name: "Section" } },
      img: { type: "image", props: { altText: "ignored" } },
      geo: { type: "geo", props: { richText: doc([{ text: "labeled" }]) } },
    });
    const result = extractSceneText(s);
    expect(result).toContain("typed");
    expect(result).toContain("Section");
    expect(result).toContain("labeled");
    expect(result).not.toContain("ignored");
  });

  it("collapses whitespace from shapes that produce whitespace-only text", () => {
    const s = scene({
      a: { type: "text", props: { richText: doc([{ text: "  " }]) } },
      b: { type: "text", props: { richText: doc([{ text: "hello" }]) } },
    });
    const result = extractSceneText(s);
    expect(result).toBe("hello");
  });
});
