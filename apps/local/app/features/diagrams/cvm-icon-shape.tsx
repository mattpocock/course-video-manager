/**
 * The `cvm-icon` shape: a vector-native lucide icon.
 *
 * The shape stores the icon's NAME, never its path data. Geometry comes from
 * the vendored, append-only table in `@/packages/lucide-icons`, so a diagram
 * saved months ago renders exactly as it did then.
 *
 * The type is `cvm-icon`, never bare `icon`: tldraw owns the unprefixed
 * namespace, and a future `icon` builtin would collide irrecoverably inside
 * already-persisted documents. Prefixing costs nothing now and is impossible
 * later.
 */

import {
  BaseBoxShapeUtil,
  DefaultColorStyle,
  DefaultDashStyle,
  Rectangle2d,
  SVGContainer,
  T,
  createShapePropsMigrationSequence,
  getColorValue,
  resizeBox,
  type Geometry2d,
  type RecordProps,
  type TLBaseShape,
  type TLDefaultColorStyle,
  type TLDefaultDashStyle,
  type TLResizeInfo,
} from "tldraw";
import {
  getIconPathBuilder,
  iconStrokeWidth,
} from "@/packages/lucide-icons/tldraw";

export const CVM_ICON_SHAPE_TYPE = "cvm-icon";

export type CvmIconShapeProps = {
  /** A lucide name, resolved against the vendored table. */
  name: string;
  w: number;
  h: number;
  color: TLDefaultColorStyle;
  dash: TLDefaultDashStyle;
};

// `w`/`h` rather than a lone `size` scalar. `size` is the truer model, but
// `props.w`/`props.h` is tldraw's STRUCTURAL interface, not a convention:
// `TLBaseBoxShape`, `resizeBox`, the box resize handles, flipping,
// `Editor.resizeShape` and the `TLContent` clipboard path all assume it. The
// scalar model would buy an invariant `onResize` has to enforce anyway (a group
// resize scales children non-uniformly regardless of the aspect lock), at the
// cost of every box helper.
//
// There is deliberately no `size`, no `fill`, no `font`, no text label, no
// `iconSetVersion`, no geometry and no provenance. `size` is DROPPED rather
// than repurposed: proportional stroke leaves `DefaultSizeStyle` with no
// rendering effect, and redefining it to mean "box size on insert" would make
// S/M/L/XL a creation control that does nothing to an existing shape — a style
// prop that isn't a style. Accepted consequence: icons ignore the style panel's
// size row, exactly as tldraw already treats shapes missing a given style.
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "cvm-icon": CvmIconShapeProps;
  }
}

export type CvmIconShape = TLBaseShape<"cvm-icon", CvmIconShapeProps>;

/**
 * The size ladder icons snap to on insert. See `quantiseIconSize` in
 * `./insert-onto-canvas` — kept there because it is the insert path, not the
 * shape, that can see the camera.
 */
export const ICON_DEFAULT_SIZE = 48;

export class CvmIconShapeUtil extends BaseBoxShapeUtil<CvmIconShape> {
  static override type = CVM_ICON_SHAPE_TYPE;

  static override props: RecordProps<CvmIconShape> = {
    // Deliberately a plain non-empty string and NOT an enum over the vendored
    // names. An unknown name has to SURVIVE validation and round-trip
    // untouched: an enum validator would throw at load and take the whole
    // document with it, converting a recoverable rendering problem into a
    // data-integrity one. Rendering handles the unknown case with a
    // placeholder; see `component` below.
    name: T.string.check("non-empty", (value) => {
      if (value.length === 0) throw new Error("icon name cannot be empty");
    }),
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    color: DefaultColorStyle,
    dash: DefaultDashStyle,
  };

  // An empty sequence, registered from the first commit despite this being
  // greenfield. Retrofitting a sequence onto a shape type that already shipped
  // without one is the painful case, and a scene from eight months ago must
  // still open. Ten lines for a permanent escape hatch — future migration ids
  // go under `com.cvm.shape.icon/<n>`.
  static override migrations = createShapePropsMigrationSequence({
    sequence: [],
  });

  override getDefaultProps(): CvmIconShape["props"] {
    return {
      name: "circle",
      w: ICON_DEFAULT_SIZE,
      h: ICON_DEFAULT_SIZE,
      color: "white",
      dash: "solid",
    };
  }

  // 17 icons carry arcs with a non-zero x-axis rotation, which a non-uniform
  // scale would shear (`rx*sx, ry*sy` is only exact when `sx == sy`).
  override isAspectRatioLocked = () => true;
  override canEdit = () => false;
  override canResize = () => true;

  override onResize(shape: CvmIconShape, info: TLResizeInfo<CvmIconShape>) {
    const resized = resizeBox(shape, info);
    // Clamp to uniform ANYWAY: a group resize can scale children
    // non-uniformly regardless of the aspect lock above.
    const side = Math.min(resized.props.w, resized.props.h);
    return { ...resized, props: { ...resized.props, w: side, h: side } };
  }

  /**
   * HIT TESTING IS STROKES-ONLY, AND THAT IS A DECISION, NOT A BUG.
   *
   * lucide icons are `fill: none`, so the transpiled `Group2d` is a set of
   * hollow subpaths and `getShapeAtPoint` only registers a hit within ~8 screen
   * px of an actual stroke. `NoteShapeUtil`, `GeoShapeUtil`, `FrameShapeUtil`
   * and `ImageShapeUtil` all put a filled `Rectangle2d` first to avoid that;
   * this is the only shape in the document that does not. Making the group's
   * first child an invisible filled rectangle would take centre-click selection
   * from 66.7% at 96px to 100% at every size — and was explicitly rejected,
   * because it makes an icon opaque to clicks aimed at whatever is behind it.
   *
   * Four accepted limitations:
   *   1. Clicking an icon's interior does nothing (66.7% centre-hit at 96px,
   *      35.8% at 200px). It degrades as the icon grows, because the 8px margin
   *      is fixed in SCREEN space while the glyph's interior gaps are not.
   *   2. Arrows bind only near a stroke and can silently detach —
   *      `ArrowShapeUtil.onTranslate` re-checks with `margin: 0`, so dragging
   *      an already-bound arrow can drop a binding a filled shape would keep.
   *   3. Erasing requires dragging across a stroke — `Erasing.ts` passes no
   *      margin at all, so the 8px cushion does not help there.
   *   4. An icon larger than the viewport cannot be clicked at all — the editor
   *      skips a hollow shape whose page bounds contain the viewport. Not
   *      reachable at sane sizes; noted for completeness.
   *
   * Box select is the escape hatch that makes this workable: it is pure bounds,
   * so lassoing an icon behaves identically either way.
   */
  override getGeometry(shape: CvmIconShape): Geometry2d {
    const path = getIconPathBuilder(shape.props.name, iconSide(shape));
    if (!path) return placeholderGeometry(shape);
    try {
      return path.toGeometry();
    } catch {
      return placeholderGeometry(shape);
    }
  }

  override component(shape: CvmIconShape) {
    const colors =
      this.editor.getCurrentTheme().colors[this.editor.getColorMode()];
    const color = getColorValue(colors, shape.props.color, "solid");
    const path = getIconPathBuilder(shape.props.name, iconSide(shape));

    // Unknown name -> a quiet placeholder, with the name preserved untouched in
    // props and surfaced as an accessible label and tooltip. Not a loud red
    // error: these render in filmed footage, and under an append-only table an
    // unknown name can essentially only come from a hand-edit or a deliberate
    // table removal.
    if (!path) {
      return (
        <SVGContainer>
          <title>{`Unknown icon "${shape.props.name}"`}</title>
          <rect
            x={1}
            y={1}
            width={Math.max(shape.props.w - 2, 0)}
            height={Math.max(shape.props.h - 2, 0)}
            fill="none"
            stroke={color}
            strokeOpacity={0.4}
            strokeDasharray="4 4"
            aria-label={`Unknown icon ${shape.props.name}`}
          />
        </SVGContainer>
      );
    }

    return (
      <SVGContainer>
        <title>{shape.props.name}</title>
        {/* Fill pass, under the stroke pass: the handful of lucide dots and
            pupils carrying fill="currentColor". They share the shape's colour —
            they are not a separate fill surface, so there is no second prop. */}
        <path fill={color} d={path.toD({ onlyFilled: true })} />
        {path.toSvg({
          style: shape.props.dash,
          strokeWidth: iconStrokeWidth(iconSide(shape)),
          randomSeed: shape.id,
          props: {
            fill: "none",
            stroke: color,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        })}
      </SVGContainer>
    );
  }

  // `indicator()` is deprecated in 5.x; returning a Path2D is the supported
  // surface, and PathBuilder.toPath2D satisfies it directly — so the selection
  // outline traces the glyph rather than boxing it.
  override getIndicatorPath(shape: CvmIconShape): Path2D | undefined {
    const path = getIconPathBuilder(shape.props.name, iconSide(shape));
    if (!path) return undefined;
    return path.toPath2D({
      style: shape.props.dash === "draw" ? "draw" : "solid",
      strokeWidth: 1,
      passes: 1,
      randomSeed: shape.id,
      offset: 0,
      roundness: 1,
    });
  }
}

/**
 * Icons are square by construction, but a group resize can briefly hand us a
 * rectangle; the glyph tracks the smaller side rather than shearing.
 *
 * Note the side comes from the shape's box, never from parsed geometry —
 * `save-off` has geometry entirely outside its 24x24 viewBox and ships as-is.
 */
function iconSide(shape: CvmIconShape): number {
  return Math.min(shape.props.w, shape.props.h);
}

function placeholderGeometry(shape: CvmIconShape): Geometry2d {
  return new Rectangle2d({
    width: shape.props.w,
    height: shape.props.h,
    isFilled: false,
  });
}
