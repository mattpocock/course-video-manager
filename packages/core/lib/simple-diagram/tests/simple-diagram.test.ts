import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  OPACITIES,
  applySimpleDiagram,
  parseSimpleDiagram,
  readSimpleDiagram,
  type Scene,
} from "../index.js";
import {
  FLOW,
  bindings,
  build,
  iconNames,
  record,
  sceneWithUnknowns,
} from "./fixtures.js";

const { name: _name, ...FLOW_SHAPES } = FLOW;

describe("round trip", () => {
  it("simple -> records -> simple gives back the same shapes", () => {
    expect(readSimpleDiagram(build(FLOW).store)).toEqual(FLOW_SHAPES);
  });

  it("is stable: a second trip through records changes nothing", () => {
    const once = readSimpleDiagram(build(FLOW).store);
    expect(readSimpleDiagram(build(once).store)).toEqual(once);
  });

  it("reads shapes back to front, in the order they were drawn", () => {
    const ids = readSimpleDiagram(build(FLOW).store).shapes.map((s) => s.id);
    expect(ids).toEqual(FLOW.shapes.map((s) => s.id));
  });

  it("leaves out fields that hold the house-style default", () => {
    const scene = build({
      shapes: [
        {
          type: "box",
          id: "b",
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          color: "black",
          fill: "none",
          dash: "draw",
          size: "m",
        },
        {
          type: "text",
          id: "t",
          x: 0,
          y: 0,
          text: "hi",
          size: "m",
          scale: 1,
          rotation: 0,
          opacity: 1,
        },
        {
          type: "arrow",
          id: "a",
          x1: 0,
          y1: 0,
          x2: 5,
          y2: 5,
          heads: "end",
          bend: 0,
          text: "",
          size: "m",
        },
      ],
    });
    expect(readSimpleDiagram(scene.store).shapes).toEqual([
      { type: "box", id: "b", x: 0, y: 0, w: 10, h: 10 },
      { type: "text", id: "t", x: 0, y: 0, text: "hi" },
      { type: "arrow", id: "a", x1: 0, y1: 0, x2: 5, y2: 5 },
    ]);
  });
});

describe("arrows", () => {
  it("turn from/to into real tldraw arrow bindings", () => {
    const scene = build(FLOW);
    const call = bindings(scene).filter((b) => b.fromId === "shape:call");
    expect(call).toEqual([
      expect.objectContaining({
        typeName: "binding",
        type: "arrow",
        fromId: "shape:call",
        toId: "shape:client",
        props: expect.objectContaining({ terminal: "start" }),
      }),
      expect.objectContaining({
        type: "arrow",
        fromId: "shape:call",
        toId: "shape:server",
        props: expect.objectContaining({ terminal: "end" }),
      }),
    ]);
  });

  it("bind only the ends that name a shape", () => {
    const scene = build(FLOW);
    const loose = bindings(scene).filter((b) => b.fromId === "shape:loose");
    expect(loose).toHaveLength(1);
    expect(loose[0]).toMatchObject({
      toId: "shape:server",
      props: { terminal: "start" },
    });
    expect(bindings(scene).filter((b) => b.fromId === "shape:free")).toEqual(
      []
    );
  });

  it("place free ends exactly where they were asked for", () => {
    const free = record(build(FLOW), "shape:free");
    expect(free).toMatchObject({ x: 0, y: 300, rotation: 0 });
    expect(free.props).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 120, y: 30 },
    });
  });

  it("carry their label as tldraw rich text", () => {
    expect(record(build(FLOW), "shape:call").props.richText).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "fetch" }] },
      ],
    });
  });
});

describe("shapes the format cannot express", () => {
  it("come back as other", () => {
    const shapes = readSimpleDiagram(sceneWithUnknowns().store).shapes;
    expect(
      shapes
        .filter((s) => s.type === "other")
        .map((s) => s.id)
        .sort()
    ).toEqual(["elbow", "frame", "inside", "labelled", "triangle"].sort());
    expect(shapes.find((s) => s.id === "a")).toEqual({
      type: "box",
      id: "a",
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
  });

  it("other covers rotated boxes, start-only heads and multi-point lines too", () => {
    const scene = build({
      shapes: [
        { type: "box", id: "rot", x: 0, y: 0, w: 10, h: 10 },
        { type: "arrow", id: "back", x1: 0, y1: 0, x2: 9, y2: 9 },
        { type: "line", id: "zig", x1: 0, y1: 0, x2: 9, y2: 9 },
      ],
    });
    const store = structuredClone(scene.store);
    store["shape:rot"]!.rotation = 0.3;
    Object.assign(store["shape:back"]!.props as object, {
      arrowheadStart: "arrow",
      arrowheadEnd: "none",
    });
    const points = (
      store["shape:zig"]!.props as { points: Record<string, unknown> }
    ).points;
    points.a3 = { id: "a3", index: "a3", x: 20, y: 0 };
    expect(readSimpleDiagram(store).shapes.map((s) => s.type)).toEqual([
      "other",
      "other",
      "other",
    ]);
  });

  it("other covers an arrow attached to one shape at both ends", () => {
    const scene = build({
      shapes: [
        { type: "box", id: "b", x: 0, y: 0, w: 10, h: 10 },
        { type: "box", id: "c", x: 50, y: 0, w: 10, h: 10 },
        { type: "arrow", id: "loop", from: "b", to: "c" },
      ],
    });
    const store = structuredClone(scene.store);
    store["binding:loop-end"]!.toId = "shape:b";
    expect(readSimpleDiagram(store).shapes.at(-1)).toEqual({
      type: "other",
      id: "loop",
    });
  });

  it("are never changed by an update, listed or not", () => {
    const before = sceneWithUnknowns();
    const read = readSimpleDiagram(before.store).shapes;
    // Keep "labelled" listed as other; drop every other `other` from the list.
    const after = build(
      { shapes: read.filter((s) => s.type !== "other" || s.id === "labelled") },
      before
    );
    for (const id of ["labelled", "triangle", "elbow", "frame", "inside"]) {
      expect(after.store[`shape:${id}`]).toEqual(before.store[`shape:${id}`]);
    }
    // ...and the elbow arrow keeps its bindings.
    expect(
      bindings(after).filter((b) => b.fromId === "shape:elbow")
    ).toHaveLength(2);
  });

  it("cannot be created: other must name a shape the Diagram already has", () => {
    const parsed = parseSimpleDiagram(
      { shapes: [{ type: "other", id: "ghost" }] },
      iconNames
    );
    if (!parsed.ok) throw new Error("expected a valid parse");
    const applied = applySimpleDiagram(null, parsed.diagram);
    expect(applied).toEqual({
      ok: false,
      errors: [
        'other "ghost": the Diagram has no shape with this id — "other" only stands for a shape read from the Diagram',
      ],
    });
  });
});

describe("size, text scale and opacity", () => {
  /** One shape of every kind, at full opacity and scale 1. */
  const plain = () =>
    build({
      shapes: [
        { type: "box", id: "b", x: 0, y: 0, w: 10, h: 10 },
        { type: "ellipse", id: "e", x: 0, y: 0, w: 10, h: 10 },
        { type: "text", id: "t", x: 0, y: 0, text: "hi" },
        { type: "arrow", id: "a", from: "b", to: "e" },
        { type: "line", id: "l", x1: 0, y1: 0, x2: 1, y2: 1 },
        { type: "icon", id: "i", x: 0, y: 0, name: "user" },
      ],
    });

  it("write tldraw's own fields: the shape's opacity, the text's props.scale", () => {
    const scene = build(FLOW);
    expect(record(scene, "shape:description")).toMatchObject({
      opacity: 0.5,
      props: { scale: 0.6778877926536484, size: "m" },
    });
    expect(record(scene, "shape:heading").props.scale).toBe(2.4360630567746884);
    expect(record(scene, "shape:server").opacity).toBe(0.75);
    expect(record(scene, "shape:free").opacity).toBe(0.25);
    expect(record(scene, "shape:slant").opacity).toBe(0.5);
    expect(record(scene, "shape:bot").opacity).toBe(0.1);
  });

  it("write a box's, ellipse's, arrow's and line's size to props.size", () => {
    const scene = build(FLOW);
    expect(record(scene, "shape:client").props.size).toBe(DEFAULTS.size);
    expect(record(scene, "shape:server").props.size).toBe("l");
    expect(record(scene, "shape:loose").props.size).toBe("s");
    expect(record(scene, "shape:slant").props.size).toBe("xl");
  });

  it("read back every opacity step on every kind, exactly", () => {
    for (const opacity of OPACITIES) {
      const store = structuredClone(plain().store);
      for (const id of ["b", "e", "t", "a", "l", "i"]) {
        store[`shape:${id}`]!.opacity = opacity;
      }
      const shapes = readSimpleDiagram(store).shapes;
      expect(shapes.map((s) => s.type)).not.toContain("other");
      expect(shapes.map((s) => ("opacity" in s ? s.opacity : 1))).toEqual(
        Array(6).fill(opacity)
      );
    }
  });

  it("read back any scale Matt dragged a text to, unrounded", () => {
    for (const scale of [0.37346433439560717, 1.3420484433058988, 5.4]) {
      const store = structuredClone(plain().store);
      (store["shape:t"]!.props as Record<string, unknown>).scale = scale;
      const text = readSimpleDiagram(store).shapes.find((s) => s.id === "t");
      expect(text).toEqual({
        type: "text",
        id: "t",
        x: 0,
        y: 0,
        text: "hi",
        scale,
      });
      // ...and writing that read-back changes nothing.
      const before = { store, schema: plain().schema };
      expect(build(readSimpleDiagram(store), before).store).toEqual(store);
    }
  });

  it("change on update only when asked, leaving the rest of the shape alone", () => {
    const before = build(FLOW);
    const shapes = readSimpleDiagram(before.store).shapes.map((s) =>
      s.id === "description"
        ? { ...s, scale: 0.5, opacity: 1 as const }
        : s.id === "client"
          ? { ...s, opacity: 0.25 as const }
          : s
    );
    const after = build({ shapes }, before);
    expect(after.store["shape:description"]).toEqual({
      ...before.store["shape:description"],
      opacity: 1,
      props: { ...record(before, "shape:description").props, scale: 0.5 },
    });
    expect(after.store["shape:client"]).toEqual({
      ...before.store["shape:client"],
      opacity: 0.25,
    });
    // Full opacity is the default, so it reads back left out.
    expect(readSimpleDiagram(after.store).shapes).toEqual(
      shapes.map((s) =>
        s.id === "description" ? { ...s, opacity: undefined } : s
      )
    );
  });

  it("an opacity between tldraw's steps, or a scale out of range, reads as other", () => {
    const store = structuredClone(plain().store);
    store["shape:b"]!.opacity = 0.3;
    (store["shape:t"]!.props as Record<string, unknown>).scale = 0;
    expect(
      readSimpleDiagram(store)
        .shapes.filter((s) => s.type === "other")
        .map((s) => s.id)
    ).toEqual(["b", "t"]);
  });
});

describe("merge on update", () => {
  /** A scene whose records carry tldraw props the format does not cover. */
  function handEdited(): Scene {
    const scene = build(FLOW);
    const store = structuredClone(scene.store);
    Object.assign(store["shape:client"]!, {
      opacity: 0.5,
      isLocked: true,
      meta: { note: "Matt" },
    });
    Object.assign(store["shape:client"]!.props as object, {
      labelColor: "red",
      scale: 2,
      growY: 12,
      url: "https://example.com",
      align: "start",
    });
    // Bold text: the words are in the format, the mark is not.
    (store["shape:client-label"]!.props as Record<string, unknown>).richText = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Client", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    (store["shape:client-label"]!.props as Record<string, unknown>).textAlign =
      "middle";
    // A precise binding anchor Matt dragged.
    const start = Object.values(store).find(
      (r) =>
        r.typeName === "binding" &&
        r.fromId === "shape:call" &&
        (r.props as { terminal: string }).terminal === "start"
    )!;
    Object.assign(start.props as object, {
      normalizedAnchor: { x: 0.9, y: 0.1 },
      isPrecise: true,
    });
    Object.assign(store["shape:call"]!.props as object, {
      labelPosition: 0.2,
      arrowheadEnd: "triangle",
    });
    store["shape:aside"]!.rotation = -0.20943951; // what tldraw stores for about -12°
    return { store, schema: scene.schema };
  }

  it("keeps every tldraw property the simple format does not cover", () => {
    const before = handEdited();
    const shapes = readSimpleDiagram(before.store).shapes.map((s) =>
      s.id === "client" ? { ...s, x: 50, color: "green" as const } : s
    );
    const after = build({ shapes }, before);

    expect(after.store["shape:client"]).toEqual({
      ...before.store["shape:client"],
      x: 50,
      props: {
        ...(before.store["shape:client"]!.props as Record<string, unknown>),
        color: "green",
      },
    });
  });

  it("an unchanged read-back rewrites nothing at all", () => {
    const before = handEdited();
    const after = build(readSimpleDiagram(before.store), before);
    expect(after.store).toEqual(before.store);
    expect(after.schema).toBe(before.schema);
  });

  it("keeps rich-text marks while the words stay the same", () => {
    const before = handEdited();
    const shapes = readSimpleDiagram(before.store).shapes.map((s) =>
      s.id === "client-label" && s.type === "text" ? { ...s, y: 99 } : s
    );
    const label = record(build({ shapes }, before), "shape:client-label");
    expect(label.y).toBe(99);
    expect(label.props).toEqual(before.store["shape:client-label"]!.props);
  });

  it("keeps a binding's anchor while its end points at the same shape", () => {
    const before = handEdited();
    const shapes = readSimpleDiagram(before.store).shapes.map((s) =>
      s.id === "call" && s.type === "arrow"
        ? { ...s, to: "db", text: "query" }
        : s
    );
    const after = build({ shapes }, before);
    const call = bindings(after).filter((b) => b.fromId === "shape:call");
    expect(call).toHaveLength(2);
    expect(
      call.find((b) => (b.props as { terminal: string }).terminal === "start")!
        .props
    ).toMatchObject({
      normalizedAnchor: { x: 0.9, y: 0.1 },
      isPrecise: true,
    });
    expect(
      call.find((b) => (b.props as { terminal: string }).terminal === "end")
    ).toMatchObject({
      toId: "shape:db",
    });
    // The custom arrowhead and label position survive a label edit.
    expect(record(after, "shape:call").props).toMatchObject({
      labelPosition: 0.2,
      arrowheadEnd: "triangle",
    });
  });

  it("creates new ids above everything, deletes unlisted ones and their bindings", () => {
    const before = build(FLOW);
    const shapes = [
      ...readSimpleDiagram(before.store).shapes.filter(
        (s) => s.id !== "server"
      ),
      { type: "box" as const, id: "cache", x: 0, y: 500, w: 50, h: 50 },
    ].map((s) =>
      s.type === "arrow" && (s.id === "call" || s.id === "loose")
        ? { ...s, to: undefined, from: "client", x2: 1, y2: 1 }
        : s
    );
    const after = build({ shapes }, before);
    expect(after.store["shape:server"]).toBeUndefined();
    expect(bindings(after).some((b) => b.toId === "shape:server")).toBe(false);
    const read = readSimpleDiagram(after.store).shapes;
    expect(read.at(-1)).toEqual({
      type: "box",
      id: "cache",
      x: 0,
      y: 500,
      w: 50,
      h: 50,
    });
  });

  it("replaces a shape whose type changed under the same id", () => {
    const before = build(FLOW);
    const shapes = readSimpleDiagram(before.store).shapes.map((s) =>
      s.id === "client"
        ? { type: "ellipse" as const, id: "client", x: 0, y: 0, w: 160, h: 80 }
        : s
    );
    const after = build({ shapes }, before);
    expect(record(after, "shape:client").props.geo).toBe("ellipse");
    expect(record(after, "shape:client").index).toBe(
      before.store["shape:client"]!.index
    );
  });
});

describe("defaults are Matt's style", () => {
  const scene = build({
    shapes: [
      { type: "box", id: "b", x: 0, y: 0, w: 10, h: 10 },
      { type: "ellipse", id: "e", x: 0, y: 0, w: 10, h: 10 },
      { type: "text", id: "t", x: 0, y: 0, text: "hi" },
      { type: "arrow", id: "a", from: "b", to: "e" },
      { type: "line", id: "l", x1: 0, y1: 0, x2: 1, y2: 1 },
      { type: "icon", id: "i", x: 0, y: 0, name: "user" },
    ],
  });

  it("draw font, size m, draw dash, black, no fill", () => {
    for (const id of ["b", "e", "a"]) {
      expect(record(scene, `shape:${id}`).props).toMatchObject({
        font: "draw",
        size: "m",
        dash: "draw",
        color: "black",
        fill: "none",
      });
    }
    expect(record(scene, "shape:t").props).toMatchObject({
      font: "draw",
      size: "m",
      color: "black",
    });
    expect(record(scene, "shape:l").props).toMatchObject({
      size: "m",
      dash: "draw",
      color: "black",
    });
    expect(DEFAULTS).toMatchObject({
      font: "draw",
      size: "m",
      dash: "draw",
      color: "black",
    });
  });

  it("no text inside boxes, end-only arrowheads, no bend", () => {
    expect(record(scene, "shape:b").props.richText).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(record(scene, "shape:a").props).toMatchObject({
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
      bend: 0,
    });
  });

  it("icons as the playground inserts them: 48px, solid", () => {
    expect(record(scene, "shape:i")).toMatchObject({
      type: "cvm-icon",
      props: { name: "user", w: 48, h: 48, dash: "solid", color: "black" },
    });
  });

  it("everything on the one page, unrotated, unlocked, opaque", () => {
    for (const r of Object.values(scene.store).filter(
      (r) => r.typeName === "shape"
    )) {
      expect(r).toMatchObject({
        parentId: "page:page",
        rotation: 0,
        isLocked: false,
        opacity: 1,
        meta: {},
      });
    }
  });
});
