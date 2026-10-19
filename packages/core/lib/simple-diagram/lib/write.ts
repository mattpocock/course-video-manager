// Internal: the simple format -> tldraw records, for a new scene or onto an
// existing one. Reach it only through `../index`.

import { generateKeyBetween } from "fractional-indexing";
import {
  DEFAULTS,
  type SimpleArrow,
  type SimpleBox,
  type SimpleDiagram,
  type SimpleEllipse,
  type SimpleIcon,
  type SimpleLine,
  type SimpleShape,
  type SimpleText,
} from "./format.js";
import { arrowEnds, isOnPage, readShape, shapesInOrder } from "./read.js";
import {
  DEFAULT_PAGE_ID,
  SCENE_SCHEMA,
  degToRad,
  emptyStore,
  isBindingRecord,
  isShapeRecord,
  toRichText,
  toShapeId,
  type BindingRecord,
  type Scene,
  type SceneStore,
  type ShapeRecord,
} from "./records.js";

export type ApplyResult =
  { ok: true; scene: Scene } | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Defaults filled in, so "did this field change?" is a plain comparison.

function full(shape: SimpleBox | SimpleEllipse) {
  return {
    ...shape,
    color: shape.color ?? DEFAULTS.color,
    fill: shape.fill ?? DEFAULTS.fill,
    dash: shape.dash ?? DEFAULTS.dash,
    size: shape.size ?? DEFAULTS.size,
    opacity: shape.opacity ?? DEFAULTS.opacity,
  };
}

function fullText(shape: SimpleText) {
  return {
    ...shape,
    size: shape.size ?? DEFAULTS.size,
    scale: shape.scale ?? DEFAULTS.scale,
    color: shape.color ?? DEFAULTS.color,
    rotation: shape.rotation ?? DEFAULTS.rotation,
    opacity: shape.opacity ?? DEFAULTS.opacity,
  };
}

function fullArrow(shape: SimpleArrow) {
  return {
    ...shape,
    text: shape.text ?? DEFAULTS.text,
    bend: shape.bend ?? DEFAULTS.bend,
    heads: shape.heads ?? DEFAULTS.heads,
    color: shape.color ?? DEFAULTS.color,
    dash: shape.dash ?? DEFAULTS.dash,
    size: shape.size ?? DEFAULTS.size,
    opacity: shape.opacity ?? DEFAULTS.opacity,
  };
}

function fullLine(shape: SimpleLine) {
  return {
    ...shape,
    color: shape.color ?? DEFAULTS.color,
    dash: shape.dash ?? DEFAULTS.dash,
    size: shape.size ?? DEFAULTS.size,
    opacity: shape.opacity ?? DEFAULTS.opacity,
  };
}

function fullIcon(shape: SimpleIcon) {
  return {
    ...shape,
    color: shape.color ?? DEFAULTS.color,
    opacity: shape.opacity ?? DEFAULTS.opacity,
  };
}

/** Keys of `next` whose value differs from `prev` (all of them with no `prev`). */
function changes<T extends object>(prev: T | null, next: T) {
  return (key: keyof T) => prev === null || prev[key] !== next[key];
}

// ---------------------------------------------------------------------------
// Fresh records: tldraw 5.2.4's own defaults, in Matt's style.

function baseShape(
  id: string,
  type: string,
  index: string,
  parentId: string,
  props: Record<string, unknown>
): ShapeRecord {
  return {
    id: toShapeId(id),
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index,
    parentId,
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  };
}

function freshProps(type: SimpleShape["type"]): Record<string, unknown> {
  switch (type) {
    case "box":
    case "ellipse":
      return {
        w: 100,
        h: 100,
        geo: type === "box" ? "rectangle" : "ellipse",
        dash: DEFAULTS.dash,
        growY: 0,
        url: "",
        scale: 1,
        color: DEFAULTS.color,
        labelColor: DEFAULTS.color,
        fill: DEFAULTS.fill,
        size: DEFAULTS.size,
        font: DEFAULTS.font,
        align: "middle",
        verticalAlign: "middle",
        richText: toRichText(""),
      };
    case "text":
      return {
        color: DEFAULTS.color,
        size: DEFAULTS.size,
        w: 8,
        font: DEFAULTS.font,
        textAlign: "start",
        autoSize: true,
        scale: 1,
        richText: toRichText(""),
      };
    case "arrow":
      return {
        kind: "arc",
        elbowMidPoint: 0.5,
        dash: DEFAULTS.dash,
        size: DEFAULTS.size,
        fill: "none",
        color: DEFAULTS.color,
        labelColor: DEFAULTS.color,
        bend: DEFAULTS.bend,
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 },
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        richText: toRichText(""),
        labelPosition: 0.5,
        font: DEFAULTS.font,
        scale: 1,
      };
    case "line":
      return {
        dash: DEFAULTS.dash,
        size: DEFAULTS.size,
        color: DEFAULTS.color,
        spline: "line",
        points: {},
        scale: 1,
      };
    case "icon":
      return {
        name: "circle",
        w: DEFAULTS.iconSize,
        h: DEFAULTS.iconSize,
        color: DEFAULTS.color,
        dash: DEFAULTS.iconDash,
      };
    case "other":
      throw new Error("an `other` shape is never built, only kept");
  }
}

const TLDRAW_TYPE = {
  box: "geo",
  ellipse: "geo",
  text: "text",
  arrow: "arrow",
  line: "line",
  icon: "cvm-icon",
} as const;

// ---------------------------------------------------------------------------

/** Where an arrow end bound to `record` points from: its centre, roughly. */
function anchorOf(record: ShapeRecord): { x: number; y: number } {
  const { w, h } = record.props;
  return {
    x: record.x + (typeof w === "number" ? w / 2 : 0),
    y: record.y + (typeof h === "number" ? h / 2 : 0),
  };
}

/**
 * Write `next` onto `record` (a fresh record, or a copy of the existing one).
 * Only fields that differ from `prev` — what the existing record reads as —
 * are written, so everything the format does not cover, and every value it
 * only approximates, survives an update untouched.
 */
function writeShape(
  record: ShapeRecord,
  prev: SimpleShape | null,
  next: Exclude<SimpleShape, { type: "other" }>,
  shapesById: ReadonlyMap<string, ShapeRecord>
): void {
  const p = record.props;
  switch (next.type) {
    case "box":
    case "ellipse": {
      const n = full(next);
      const changed = changes(prev?.type === next.type ? full(prev) : null, n);
      if (changed("x")) record.x = n.x;
      if (changed("y")) record.y = n.y;
      if (changed("w")) p.w = n.w;
      if (changed("h")) p.h = n.h;
      if (changed("color")) p.color = n.color;
      if (changed("fill")) p.fill = n.fill;
      if (changed("dash")) p.dash = n.dash;
      if (changed("size")) p.size = n.size;
      if (changed("opacity")) record.opacity = n.opacity;
      return;
    }
    case "text": {
      const n = fullText(next);
      const changed = changes(prev?.type === "text" ? fullText(prev) : null, n);
      if (changed("x")) record.x = n.x;
      if (changed("y")) record.y = n.y;
      if (changed("text")) p.richText = toRichText(n.text);
      if (changed("size")) p.size = n.size;
      if (changed("scale")) p.scale = n.scale;
      if (changed("color")) p.color = n.color;
      if (changed("rotation")) record.rotation = degToRad(n.rotation);
      if (changed("opacity")) record.opacity = n.opacity;
      return;
    }
    case "arrow": {
      const n = fullArrow(next);
      const changed = changes(
        prev?.type === "arrow" ? fullArrow(prev) : null,
        n
      );
      if (changed("text")) p.richText = toRichText(n.text);
      if (changed("bend")) p.bend = n.bend;
      if (changed("color")) {
        p.color = n.color;
        p.labelColor = n.color;
      }
      if (changed("dash")) p.dash = n.dash;
      if (changed("size")) p.size = n.size;
      if (changed("opacity")) record.opacity = n.opacity;
      if (changed("heads")) {
        p.arrowheadStart = n.heads === "both" ? "arrow" : "none";
        p.arrowheadEnd = n.heads === "none" ? "none" : "arrow";
      }
      const geometry = (["from", "to", "x1", "y1", "x2", "y2"] as const).some(
        changed
      );
      if (geometry) {
        // A bound end's position is tldraw's to work out from the binding;
        // these coordinates only seed it, and place the free ends exactly.
        const fromShape = n.from ? shapesById.get(n.from) : undefined;
        const toShape = n.to ? shapesById.get(n.to) : undefined;
        const a = fromShape
          ? anchorOf(fromShape)
          : { x: n.x1 ?? 0, y: n.y1 ?? 0 };
        const b = toShape ? anchorOf(toShape) : { x: n.x2 ?? 0, y: n.y2 ?? 0 };
        record.x = a.x;
        record.y = a.y;
        record.rotation = 0;
        p.start = { x: 0, y: 0 };
        p.end = { x: b.x - a.x, y: b.y - a.y };
      }
      return;
    }
    case "line": {
      const n = fullLine(next);
      const changed = changes(prev?.type === "line" ? fullLine(prev) : null, n);
      if (changed("color")) p.color = n.color;
      if (changed("dash")) p.dash = n.dash;
      if (changed("size")) p.size = n.size;
      if (changed("opacity")) record.opacity = n.opacity;
      if ((["x1", "y1", "x2", "y2"] as const).some(changed)) {
        record.x = n.x1;
        record.y = n.y1;
        record.rotation = 0;
        p.points = {
          a1: { id: "a1", index: "a1", x: 0, y: 0 },
          a2: { id: "a2", index: "a2", x: n.x2 - n.x1, y: n.y2 - n.y1 },
        };
      }
      return;
    }
    case "icon": {
      const n = fullIcon(next);
      const changed = changes(prev?.type === "icon" ? fullIcon(prev) : null, n);
      if (changed("x")) record.x = n.x;
      if (changed("y")) record.y = n.y;
      if (changed("name")) p.name = n.name;
      if (changed("color")) p.color = n.color;
      if (changed("opacity")) record.opacity = n.opacity;
      return;
    }
  }
}

function arrowBinding(
  arrowId: string,
  terminal: "start" | "end",
  targetId: string
): BindingRecord {
  return {
    id: `binding:${arrowId}-${terminal}`,
    typeName: "binding",
    type: "arrow",
    fromId: toShapeId(arrowId),
    toId: toShapeId(targetId),
    props: {
      terminal,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: "none",
    },
    meta: {},
  };
}

/**
 * Apply a VALIDATED simple Diagram (see `parseSimpleDiagram`) to a scene.
 *
 * With no scene, builds a new one. With a scene, the list is the whole
 * Diagram, matched by id: a listed id updates its shape in place (merge — see
 * `writeShape`), a new id creates one, a shape the format can express that is
 * no longer listed is deleted, and an `other` shape is never changed or
 * deleted, listed or not.
 */
export function applySimpleDiagram(
  existing: Scene | null,
  diagram: SimpleDiagram
): ApplyResult {
  const before: SceneStore = existing ? existing.store : emptyStore();
  const store: SceneStore = structuredClone(before);
  const ends = arrowEnds(before);
  const ordered = shapesInOrder(before);

  const existingById = new Map<string, ShapeRecord>();
  const prevById = new Map<string, SimpleShape>();
  for (const record of ordered) {
    const prev = readShape(record, ends.get(record.id) ?? {}, isOnPage(record));
    existingById.set(prev.id, record);
    prevById.set(prev.id, prev);
  }

  const errors: string[] = [];
  for (const shape of diagram.shapes) {
    if (shape.type === "other" && !existingById.has(shape.id)) {
      errors.push(
        `other "${shape.id}": the Diagram has no shape with this id — "other" only stands for a shape read from the Diagram`
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const pageId =
    ordered.find(isOnPage)?.parentId ??
    Object.values(before).find((r) => r.typeName === "page")?.id ??
    DEFAULT_PAGE_ID;
  let topIndex: string | null = ordered.at(-1)?.index ?? null;
  const nextIndex = () => (topIndex = generateKeyBetween(topIndex, null));

  // Delete what the format owns and the list no longer names.
  const listed = new Set(diagram.shapes.map((s) => s.id));
  for (const [simpleId, prev] of prevById) {
    if (prev.type !== "other" && !listed.has(simpleId)) {
      delete store[toShapeId(simpleId)];
    }
  }

  // Build or merge every listed shape. Arrows last, so their anchors see the
  // shapes they point at in their final place.
  const shapesById = new Map<string, ShapeRecord>();
  for (const [simpleId, record] of existingById) {
    const current = store[record.id];
    if (isShapeRecord(current)) shapesById.set(simpleId, current);
  }
  const drawable = diagram.shapes.filter(
    (s): s is Exclude<SimpleShape, { type: "other" }> => s.type !== "other"
  );
  // Indexes first, in list order, so a new shape's z-order is where it was
  // listed, whatever order the records are built in.
  const indexOf = new Map<string, string>();
  for (const shape of drawable) {
    const old = existingById.get(shape.id);
    indexOf.set(shape.id, old && isOnPage(old) ? old.index : nextIndex());
  }
  const arrowsLast = [
    ...drawable.filter((s) => s.type !== "arrow"),
    ...drawable.filter((s) => s.type === "arrow"),
  ];
  for (const shape of arrowsLast) {
    const prev = prevById.get(shape.id) ?? null;
    const old = existingById.get(shape.id);
    const sameKind = prev !== null && prev.type === shape.type;
    const record: ShapeRecord =
      sameKind && old
        ? (store[old.id] as ShapeRecord)
        : baseShape(
            shape.id,
            TLDRAW_TYPE[shape.type],
            indexOf.get(shape.id) ?? nextIndex(),
            pageId,
            freshProps(shape.type)
          );
    writeShape(record, sameKind ? prev : null, shape, shapesById);
    store[record.id] = record;
    shapesById.set(shape.id, record);
  }

  // Bindings: drop any that lost a shape, and rebuild each listed arrow's
  // ends — keeping an existing binding (and its anchor) when its end still
  // points at the same shape.
  const arrows = new Map(
    drawable
      .filter((s): s is SimpleArrow => s.type === "arrow")
      .map((a) => [toShapeId(a.id), a])
  );
  const kept = new Set<string>();
  for (const record of Object.values(before)) {
    if (!isBindingRecord(record)) continue;
    const arrow = arrows.get(record.fromId);
    const lostShape = !store[record.fromId] || !store[record.toId];
    const wanted =
      arrow === undefined ||
      (record.props.terminal === "start" &&
        arrow.from !== undefined &&
        toShapeId(arrow.from) === record.toId) ||
      (record.props.terminal === "end" &&
        arrow.to !== undefined &&
        toShapeId(arrow.to) === record.toId);
    if (lostShape || !wanted) {
      delete store[record.id];
    } else if (arrow) {
      kept.add(`${record.fromId}|${String(record.props.terminal)}`);
    }
  }
  for (const [shapeId, arrow] of arrows) {
    for (const [terminal, target] of [
      ["start", arrow.from],
      ["end", arrow.to],
    ] as const) {
      if (target === undefined || kept.has(`${shapeId}|${terminal}`)) continue;
      const binding = arrowBinding(arrow.id, terminal, target);
      store[binding.id] = binding;
    }
  }

  return {
    ok: true,
    scene: { store, schema: existing ? existing.schema : SCENE_SCHEMA },
  };
}
