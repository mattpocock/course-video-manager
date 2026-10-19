// Internal: tldraw records -> the simple format. Anything the format cannot
// say without losing something comes back as `other`. Reach it only through
// `../index`.

import {
  COLORS,
  DASHES,
  DEFAULTS,
  FILLS,
  MAX_SCALE,
  MIN_SCALE,
  OPACITIES,
  SIZES,
  type SimpleArrow,
  type SimpleColor,
  type SimpleDash,
  type SimpleDiagram,
  type SimpleFill,
  type SimpleOpacity,
  type SimpleShape,
  type SimpleSize,
} from "./format.js";
import {
  fromRichText,
  isBindingRecord,
  isShapeRecord,
  radToDeg,
  round,
  toPage,
  toSimpleId,
  type SceneStore,
  type ShapeRecord,
} from "./records.js";

/** Which shape each end of an arrow is bound to, as tldraw shape ids. */
export interface ArrowEnds {
  start?: string;
  end?: string;
}

function oneOf<T extends string>(values: readonly T[], value: unknown) {
  return (values as readonly unknown[]).includes(value)
    ? (value as T)
    : undefined;
}

function point(value: unknown): { x: number; y: number } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

/**
 * A shape's opacity, when it is one of tldraw's steps. A record without one
 * is opaque; any other value is one the format cannot say.
 */
function opacityOf(record: ShapeRecord): SimpleOpacity | undefined {
  const value = record.opacity ?? DEFAULTS.opacity;
  return (OPACITIES as readonly unknown[]).includes(value)
    ? (value as SimpleOpacity)
    : undefined;
}

/** A text's scale, exactly as stored, when it is within the format's range. */
function scaleOf(value: unknown): number | undefined {
  const scale = value ?? DEFAULTS.scale;
  return typeof scale === "number" && scale >= MIN_SCALE && scale <= MAX_SCALE
    ? scale
    : undefined;
}

/** Sets `key` only when it differs from the house-style default. */
function unlessDefault<T>(value: T, fallback: T): T | undefined {
  return value === fallback ? undefined : value;
}

function compact<T extends object>(shape: T): T {
  return Object.fromEntries(
    Object.entries(shape).filter(([, v]) => v !== undefined)
  ) as T;
}

/**
 * Read one tldraw shape. `onPage` is false for a shape inside a frame or a
 * group, whose coordinates are relative to its parent — the format has no
 * parents, so it is `other`.
 */
export function readShape(
  record: ShapeRecord,
  ends: ArrowEnds,
  onPage: boolean
): SimpleShape {
  const id = toSimpleId(record.id);
  const other: SimpleShape = { type: "other", id };
  if (!onPage) return other;
  const p = record.props;
  const opacity = opacityOf(record);
  if (opacity === undefined) return other;
  const opacityField = unlessDefault(opacity, DEFAULTS.opacity);

  switch (record.type) {
    case "geo": {
      const kind =
        p.geo === "rectangle" ? "box" : p.geo === "ellipse" ? "ellipse" : null;
      const color = oneOf<SimpleColor>(COLORS, p.color);
      const fill = oneOf<SimpleFill>(FILLS, p.fill);
      const dash = oneOf<SimpleDash>(DASHES, p.dash);
      const size = oneOf<SimpleSize>(SIZES, p.size);
      if (
        !kind ||
        !color ||
        !fill ||
        !dash ||
        !size ||
        typeof p.w !== "number" ||
        typeof p.h !== "number" ||
        record.rotation !== 0 ||
        // A label inside the box: Matt writes text as its own shape, so a
        // labelled box is the rare case the format leaves alone.
        fromRichText(p.richText).trim() !== ""
      ) {
        return other;
      }
      return compact({
        type: kind,
        id,
        x: record.x,
        y: record.y,
        w: p.w,
        h: p.h,
        color: unlessDefault(color, DEFAULTS.color),
        fill: unlessDefault(fill, DEFAULTS.fill),
        dash: unlessDefault(dash, DEFAULTS.dash),
        size: unlessDefault(size, DEFAULTS.size),
        opacity: opacityField,
      });
    }
    case "text": {
      const color = oneOf<SimpleColor>(COLORS, p.color);
      const size = oneOf<SimpleSize>(SIZES, p.size);
      const scale = scaleOf(p.scale);
      const text = fromRichText(p.richText);
      if (!color || !size || scale === undefined || text === "") return other;
      return compact({
        type: "text",
        id,
        x: record.x,
        y: record.y,
        text,
        size: unlessDefault(size, DEFAULTS.size),
        scale: unlessDefault(scale, DEFAULTS.scale),
        color: unlessDefault(color, DEFAULTS.color),
        rotation: unlessDefault(radToDeg(record.rotation), DEFAULTS.rotation),
        opacity: opacityField,
      });
    }
    case "arrow": {
      const color = oneOf<SimpleColor>(COLORS, p.color);
      const dash = oneOf<SimpleDash>(DASHES, p.dash);
      const size = oneOf<SimpleSize>(SIZES, p.size);
      const start = point(p.start);
      const end = point(p.end);
      const hasStartHead = p.arrowheadStart !== "none";
      const hasEndHead = p.arrowheadEnd !== "none";
      if (
        p.kind === "elbow" ||
        !color ||
        !dash ||
        !size ||
        !start ||
        !end ||
        typeof p.bend !== "number" ||
        // A head on the start only: the format cannot say it.
        (hasStartHead && !hasEndHead) ||
        // Both ends on one shape: a loop the format refuses to draw.
        (ends.start !== undefined && ends.start === ends.end)
      ) {
        return other;
      }
      const heads = hasStartHead ? "both" : hasEndHead ? "end" : "none";
      const from = ends.start ? toSimpleId(ends.start) : undefined;
      const to = ends.end ? toSimpleId(ends.end) : undefined;
      const a = from ? undefined : toPage(record, start);
      const b = to ? undefined : toPage(record, end);
      const arrow: SimpleArrow = {
        type: "arrow",
        id,
        from,
        to,
        x1: a?.x,
        y1: a?.y,
        x2: b?.x,
        y2: b?.y,
        text: unlessDefault(fromRichText(p.richText), DEFAULTS.text),
        bend: unlessDefault(round(p.bend), DEFAULTS.bend),
        heads: unlessDefault(heads, DEFAULTS.heads),
        color: unlessDefault(color, DEFAULTS.color),
        dash: unlessDefault(dash, DEFAULTS.dash),
        size: unlessDefault(size, DEFAULTS.size),
        opacity: opacityField,
      };
      return compact(arrow);
    }
    case "line": {
      const color = oneOf<SimpleColor>(COLORS, p.color);
      const dash = oneOf<SimpleDash>(DASHES, p.dash);
      const size = oneOf<SimpleSize>(SIZES, p.size);
      const points =
        p.points !== null && typeof p.points === "object"
          ? Object.values(p.points as Record<string, unknown>)
          : [];
      if (!color || !dash || !size || points.length !== 2) return other;
      const sorted = [...points].sort((l, r) => {
        const li = String((l as { index?: unknown }).index);
        const ri = String((r as { index?: unknown }).index);
        return li < ri ? -1 : li > ri ? 1 : 0;
      });
      const first = point(sorted[0]);
      const second = point(sorted[1]);
      if (!first || !second) return other;
      const a = toPage(record, first);
      const b = toPage(record, second);
      return compact({
        type: "line",
        id,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: unlessDefault(color, DEFAULTS.color),
        dash: unlessDefault(dash, DEFAULTS.dash),
        size: unlessDefault(size, DEFAULTS.size),
        opacity: opacityField,
      });
    }
    case "cvm-icon": {
      const color = oneOf<SimpleColor>(COLORS, p.color);
      if (!color || typeof p.name !== "string" || p.name === "") return other;
      return compact({
        type: "icon",
        id,
        x: record.x,
        y: record.y,
        name: p.name,
        color: unlessDefault(color, DEFAULTS.color),
        opacity: opacityField,
      });
    }
    default:
      return other;
  }
}

/** Arrow bindings in a store, by arrow id. */
export function arrowEnds(store: SceneStore): Map<string, ArrowEnds> {
  const result = new Map<string, ArrowEnds>();
  for (const record of Object.values(store)) {
    if (!isBindingRecord(record) || record.type !== "arrow") continue;
    if (!isShapeRecord(store[record.toId])) continue;
    const ends = result.get(record.fromId) ?? {};
    if (record.props.terminal === "start") ends.start = record.toId;
    if (record.props.terminal === "end") ends.end = record.toId;
    result.set(record.fromId, ends);
  }
  return result;
}

/** A store's shapes in z-order (tldraw's fractional `index`, back to front). */
export function shapesInOrder(store: SceneStore): ShapeRecord[] {
  return Object.values(store)
    .filter(isShapeRecord)
    .sort((l, r) => (l.index < r.index ? -1 : l.index > r.index ? 1 : 0));
}

export function isOnPage(record: ShapeRecord): boolean {
  return (
    typeof record.parentId === "string" && record.parentId.startsWith("page:")
  );
}

/**
 * A scene's store as a simple Diagram, back to front. The Diagram's name is
 * not in the scene, so it is not in the result.
 */
export function readSimpleDiagram(store: SceneStore): SimpleDiagram {
  const ends = arrowEnds(store);
  return {
    shapes: shapesInOrder(store).map((record) =>
      readShape(record, ends.get(record.id) ?? {}, isOnPage(record))
    ),
  };
}
