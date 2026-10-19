// Shared fixtures for the simple-diagram tests. Not a test file itself.

import {
  applySimpleDiagram,
  parseSimpleDiagram,
  type Scene,
  type SceneRecord,
  type SimpleDiagram,
} from "../index.js";

/**
 * The Lucide names icons may use are injected (the CLI passes `ICON_NAMES`
 * from `@cvm/lucide-icons`); a handful stand in for them here.
 */
export const iconNames: ReadonlySet<string> = new Set([
  "bot",
  "database",
  "user",
]);

/** Parse, then apply — failing the test on any error. */
export function build(input: unknown, existing: Scene | null = null): Scene {
  const parsed = parseSimpleDiagram(input, iconNames);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const applied = applySimpleDiagram(existing, parsed.diagram);
  if (!applied.ok) throw new Error(applied.errors.join("\n"));
  return applied.scene;
}

export function record(
  scene: Scene,
  id: string
): SceneRecord & {
  props: Record<string, unknown>;
} {
  const found = scene.store[id];
  if (!found) throw new Error(`no record ${id}`);
  return found as SceneRecord & { props: Record<string, unknown> };
}

export function bindings(scene: Scene): SceneRecord[] {
  return Object.values(scene.store).filter((r) => r.typeName === "binding");
}

/** A small Diagram in Matt's style: two boxes, labels, an arrow, an icon. */
export const FLOW: SimpleDiagram = {
  name: "Flow",
  shapes: [
    { type: "box", id: "client", x: 0, y: 0, w: 160, h: 80 },
    {
      type: "ellipse",
      id: "server",
      x: 400,
      y: 0,
      w: 160,
      h: 80,
      color: "light-blue",
      fill: "semi",
      dash: "solid",
      size: "l",
      opacity: 0.75,
    },
    { type: "text", id: "client-label", x: 40, y: 25, text: "Client" },
    {
      // A heading and a faded description, at scales Matt really uses.
      type: "text",
      id: "heading",
      x: 0,
      y: -120,
      text: "Agent loop",
      scale: 2.4360630567746884,
    },
    {
      type: "text",
      id: "description",
      x: 0,
      y: -60,
      text: "Runs until the work is done.",
      scale: 0.6778877926536484,
      opacity: 0.5,
    },
    {
      type: "text",
      id: "aside",
      x: 200,
      y: 160,
      text: "hand-written\naside",
      size: "s",
      color: "red",
      rotation: -12,
    },
    { type: "arrow", id: "call", from: "client", to: "server", text: "fetch" },
    {
      type: "arrow",
      id: "loose",
      from: "server",
      x2: 600,
      y2: 200,
      bend: 20,
      heads: "both",
      color: "violet",
      dash: "dashed",
      size: "s",
    },
    {
      type: "arrow",
      id: "free",
      x1: 0,
      y1: 300,
      x2: 120,
      y2: 330,
      heads: "none",
      opacity: 0.25,
    },
    { type: "line", id: "divider", x1: 0, y1: 250, x2: 560, y2: 250 },
    {
      type: "line",
      id: "slant",
      x1: 10,
      y1: 400,
      x2: 90,
      y2: 360,
      dash: "dotted",
      color: "grey",
      size: "xl",
      opacity: 0.5,
    },
    { type: "icon", id: "db", x: 460, y: 100, name: "database" },
    {
      type: "icon",
      id: "bot",
      x: 20,
      y: 100,
      name: "bot",
      color: "orange",
      opacity: 0.1,
    },
  ],
};

/** A hand-drawn scene with things the format cannot say. */
export function sceneWithUnknowns(): Scene {
  const scene = build({
    shapes: [
      { type: "box", id: "a", x: 0, y: 0, w: 100, h: 50 },
      { type: "box", id: "labelled", x: 200, y: 0, w: 100, h: 50 },
      { type: "box", id: "triangle", x: 400, y: 0, w: 100, h: 50 },
      { type: "arrow", id: "elbow", from: "a", to: "labelled" },
      { type: "text", id: "inside", x: 10, y: 10, text: "in a frame" },
    ],
  });
  const store = structuredClone(scene.store);
  (store["shape:labelled"]!.props as Record<string, unknown>).richText = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Label" }] },
    ],
  };
  (store["shape:triangle"]!.props as Record<string, unknown>).geo = "triangle";
  (store["shape:elbow"]!.props as Record<string, unknown>).kind = "elbow";
  store["shape:frame"] = {
    ...structuredClone(store["shape:a"]!),
    id: "shape:frame",
    type: "frame",
    index: "a0V",
    props: { w: 300, h: 300, name: "Frame", color: "black" },
  };
  store["shape:inside"]!.parentId = "shape:frame";
  return { store, schema: scene.schema };
}
