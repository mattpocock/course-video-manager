// Internal: the simple shape format itself — its zod schema, its types and
// Matt's house-style defaults. Reach it only through `../index`.

import { z } from "zod";

/** tldraw's own colour names (`DefaultColorStyle`). */
export const COLORS = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "white",
] as const;

/** tldraw's own fill names (`DefaultFillStyle`). */
export const FILLS = [
  "none",
  "semi",
  "solid",
  "pattern",
  "fill",
  "lined-fill",
] as const;

/** tldraw's own dash names (`DefaultDashStyle`). */
export const DASHES = ["draw", "solid", "dashed", "dotted", "none"] as const;

/**
 * tldraw's own size names (`DefaultSizeStyle`): a text's font size, and the
 * stroke of a box, ellipse, arrow or line.
 */
export const SIZES = ["s", "m", "l", "xl"] as const;

/**
 * The opacity steps tldraw's style panel offers
 * (`tldrawSupportedOpacities` in tldraw 5.2.4's DefaultStylePanelContent).
 * The only opacities Matt's Diagrams hold.
 */
export const OPACITIES = [0.1, 0.25, 0.5, 0.75, 1] as const;

/**
 * The bounds of a text's `scale`. tldraw takes any positive number (Matt's
 * Diagrams hold 0.35 to 5.4, from dragging text bigger or smaller); these
 * only stop a value that is plainly a mistake.
 */
export const MIN_SCALE = 0.01;
export const MAX_SCALE = 100;

/** Which ends of an arrow carry a head. */
export const HEADS = ["end", "both", "none"] as const;

export const SHAPE_TYPES = [
  "box",
  "ellipse",
  "text",
  "arrow",
  "line",
  "icon",
  "other",
] as const;

export type SimpleColor = (typeof COLORS)[number];
export type SimpleFill = (typeof FILLS)[number];
export type SimpleDash = (typeof DASHES)[number];
export type SimpleSize = (typeof SIZES)[number];
export type SimpleOpacity = (typeof OPACITIES)[number];
export type SimpleHeads = (typeof HEADS)[number];
export type SimpleShapeType = (typeof SHAPE_TYPES)[number];

/**
 * Matt's house style, measured on his live Diagrams (font `draw` everywhere,
 * size `m` on 542 of 586 shapes, dash `draw` the most common, black the most
 * common colour, end-only arrowheads on 62 of 72 arrows). Every optional field
 * an agent leaves out takes its value from here, and `get` leaves out every
 * field that still holds it.
 */
export const DEFAULTS = {
  color: "black",
  fill: "none",
  dash: "draw",
  size: "m",
  font: "draw",
  heads: "end",
  bend: 0,
  rotation: 0,
  scale: 1,
  opacity: 1,
  text: "",
  /** An icon's dash: the playground inserts icons solid, not draw. */
  iconDash: "solid",
  /** The playground's own insert size for an icon (`ICON_DEFAULT_SIZE`). */
  iconSize: 48,
} as const;

/**
 * An agent-chosen id. Restricted to the characters tldraw's own generated ids
 * use, so every id a Diagram already holds reads back unchanged.
 */
const Id = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "must be letters, digits, '_' or '-' (e.g. \"box-1\")"
  );

/**
 * The most shapes one drawing may hold. Matt's Diagrams hold about 10; this
 * only stops a runaway file before it is drawn and stored.
 */
export const MAX_SHAPES = 500;

/**
 * How far from the origin a coordinate, size or bend may be, in canvas
 * pixels. A Diagram is filmed in about 1600x900; this only stops a value that
 * is plainly a mistake.
 */
export const MAX_COORDINATE = 100_000;

const inRange = `must be between -${MAX_COORDINATE} and ${MAX_COORDINATE}`;
const num = z
  .number()
  .finite()
  .gte(-MAX_COORDINATE, inRange)
  .lte(MAX_COORDINATE, inRange);
const positive = num.positive();

const opacity = z
  .number()
  .refine((n) => (OPACITIES as readonly number[]).includes(n), {
    message: `must be one of ${OPACITIES.join(", ")} (tldraw's opacity steps)`,
  });

const scaleRange = `must be a number from ${MIN_SCALE} to ${MAX_SCALE} (1 = unscaled)`;
const scale = z
  .number(scaleRange)
  .finite(scaleRange)
  .gte(MIN_SCALE, scaleRange)
  .lte(MAX_SCALE, scaleRange);

const Box = z.strictObject({
  type: z.literal("box"),
  id: Id,
  x: num,
  y: num,
  w: positive,
  h: positive,
  color: z.enum(COLORS).optional(),
  fill: z.enum(FILLS).optional(),
  dash: z.enum(DASHES).optional(),
  size: z.enum(SIZES).optional(),
  opacity: opacity.optional(),
});

const Ellipse = Box.extend({ type: z.literal("ellipse") });

const Text = z.strictObject({
  type: z.literal("text"),
  id: Id,
  x: num,
  y: num,
  text: z.string().min(1, "must not be empty"),
  size: z.enum(SIZES).optional(),
  /** tldraw's text `scale`: multiplies the size. Any value in range. */
  scale: scale.optional(),
  color: z.enum(COLORS).optional(),
  /** Degrees, clockwise. */
  rotation: num.optional(),
  opacity: opacity.optional(),
});

const Arrow = z.strictObject({
  type: z.literal("arrow"),
  id: Id,
  from: Id.optional(),
  to: Id.optional(),
  x1: num.optional(),
  y1: num.optional(),
  x2: num.optional(),
  y2: num.optional(),
  text: z.string().optional(),
  bend: num.optional(),
  heads: z.enum(HEADS).optional(),
  color: z.enum(COLORS).optional(),
  dash: z.enum(DASHES).optional(),
  size: z.enum(SIZES).optional(),
  opacity: opacity.optional(),
});

const Line = z.strictObject({
  type: z.literal("line"),
  id: Id,
  x1: num,
  y1: num,
  x2: num,
  y2: num,
  color: z.enum(COLORS).optional(),
  dash: z.enum(DASHES).optional(),
  size: z.enum(SIZES).optional(),
  opacity: opacity.optional(),
});

const Icon = z.strictObject({
  type: z.literal("icon"),
  id: Id,
  x: num,
  y: num,
  name: z.string().min(1, "must not be empty"),
  color: z.enum(COLORS).optional(),
  opacity: opacity.optional(),
});

const Other = z.strictObject({
  type: z.literal("other"),
  id: Id,
});

/** One schema per shape type, looked up by `type` before parsing. */
export const SHAPE_SCHEMAS = {
  box: Box,
  ellipse: Ellipse,
  text: Text,
  arrow: Arrow,
  line: Line,
  icon: Icon,
  other: Other,
} as const satisfies Record<SimpleShapeType, z.ZodType>;

export const DiagramEnvelope = z.strictObject({
  name: z.string().optional(),
  shapes: z.array(z.unknown()),
});

export type SimpleBox = z.infer<typeof Box>;
export type SimpleEllipse = z.infer<typeof Ellipse>;
export type SimpleText = z.infer<typeof Text>;
export type SimpleArrow = z.infer<typeof Arrow>;
export type SimpleLine = z.infer<typeof Line>;
export type SimpleIcon = z.infer<typeof Icon>;
export type SimpleOther = z.infer<typeof Other>;

export type SimpleShape =
  | SimpleBox
  | SimpleEllipse
  | SimpleText
  | SimpleArrow
  | SimpleLine
  | SimpleIcon
  | SimpleOther;

export interface SimpleDiagram {
  name?: string;
  shapes: SimpleShape[];
}
