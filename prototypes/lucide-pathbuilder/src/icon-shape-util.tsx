/**
 * PROTOTYPE — throwaway. The custom vector-native lucide icon shape.
 *
 * Shape props store the icon NAME, never path data (map decision 4).
 * Colour comes from tldraw's DefaultColorStyle (decision 5).
 */

import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  Group2d,
  Rectangle2d,
  SVGContainer,
  ShapeUtil,
  T,
  getColorValue,
  resizeBox,
} from "tldraw";
import type {
  Geometry2d,
  RecordProps,
  Resizable,
  TLBaseShape,
  TLDefaultColorStyle,
  TLDefaultDashStyle,
  TLDefaultSizeStyle,
  TLResizeInfo,
} from "tldraw";
import {
  LUCIDE_STROKE_WIDTH,
  LUCIDE_VIEWBOX,
  iconNodeToPathBuilder,
  type IconNode,
} from "./lucide-to-path-builder";
import iconNodes from "./icon-nodes.json";

const ICONS = iconNodes as unknown as Record<string, IconNode>;

export type IconShape = TLBaseShape<
  "lucide-icon",
  {
    w: number;
    h: number;
    name: string;
    color: TLDefaultColorStyle;
    size: TLDefaultSizeStyle;
    dash: TLDefaultDashStyle;
  }
>;

/**
 * Two candidate answers to "how does stroke-width 2 scale when the shape
 * resizes?" — flipped at runtime by the prototype's toolbar so they can be
 * compared side by side.
 *
 *  - "proportional": stroke = 2 * (size / 24). The icon looks exactly like
 *    lucide at every size; a 400px icon has a 33px stroke.
 *  - "tldraw": stroke comes from DefaultSizeStyle (s/m/l/xl = 2/3.5/5/10),
 *    independent of the shape's box, so it matches neighbouring tldraw shapes
 *    but the glyph gets progressively spindlier as it grows.
 */
export type StrokeMode = "proportional" | "tldraw";
export const TLDRAW_STROKE_SIZES: Record<TLDefaultSizeStyle, number> = {
  s: 2,
  m: 3.5,
  l: 5,
  xl: 10,
};

/**
 * Two candidate answers to "does clicking the middle of an icon select it?"
 *
 *  - "stroke": geometry is exactly the glyph. Faithful, but a lucide icon is
 *    `fill: none` — the middle of the shape is empty space, so a click there
 *    only lands if some stroke happens to be within the 8px hit margin.
 *  - "filled-box": prepend an invisible filled rectangle covering the shape's
 *    bounds. `getShapeAtPoint` treats a Group2d as filled when its FIRST child
 *    is filled, so anywhere inside the box selects the icon — at the cost of
 *    the icon becoming opaque to clicks aimed at shapes behind it.
 */
export type HitMode = "stroke" | "filled-box";
let hitMode: HitMode = "stroke";
export function setHitMode(mode: HitMode) {
  hitMode = mode;
}
export function getHitMode() {
  return hitMode;
}

let strokeMode: StrokeMode = "proportional";
export function setStrokeMode(mode: StrokeMode) {
  strokeMode = mode;
}
export function getStrokeMode() {
  return strokeMode;
}

export function strokeWidthFor(shape: IconShape) {
  return strokeMode === "proportional"
    ? (LUCIDE_STROKE_WIDTH * Math.min(shape.props.w, shape.props.h)) /
        LUCIDE_VIEWBOX
    : TLDRAW_STROKE_SIZES[shape.props.size];
}

export function getIconPath(shape: IconShape) {
  const node = ICONS[shape.props.name];
  if (!node) throw new Error(`unknown lucide icon "${shape.props.name}"`);
  return iconNodeToPathBuilder(node, Math.min(shape.props.w, shape.props.h));
}

export class IconShapeUtil extends ShapeUtil<IconShape> {
  static override type = "lucide-icon" as const;
  static override props: RecordProps<IconShape> = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    name: T.string,
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
    dash: DefaultDashStyle,
  };

  getDefaultProps(): IconShape["props"] {
    return {
      w: 96,
      h: 96,
      name: "star",
      color: "black",
      size: "m",
      dash: "solid",
    };
  }

  // Icons are square by construction — a non-uniform scale would shear the
  // 17 icons whose arcs carry a non-zero x-axis rotation.
  override isAspectRatioLocked = () => true;
  override canResize = () => true;
  override canEdit = () => false;
  override hideResizeHandles = () => false;

  override getGeometry(shape: IconShape): Geometry2d {
    let glyph: Geometry2d;
    try {
      glyph = getIconPath(shape).toGeometry();
    } catch {
      glyph = new Rectangle2d({
        width: shape.props.w,
        height: shape.props.h,
        isFilled: false,
      });
    }
    if (hitMode === "stroke") return glyph;
    return new Group2d({
      children: [
        new Rectangle2d({
          width: shape.props.w,
          height: shape.props.h,
          isFilled: true,
        }),
        glyph,
      ],
    });
  }

  override onResize(shape: IconShape, info: TLResizeInfo<IconShape>) {
    return resizeBox(shape as Resizable, info);
  }

  override component(shape: IconShape) {
    const colors = this.editor.getCurrentTheme().colors[
      this.editor.getColorMode()
    ];
    const path = getIconPath(shape);
    const strokeWidth = strokeWidthFor(shape);
    const color = getColorValue(colors, shape.props.color, "solid");

    return (
      <SVGContainer>
        {/* Fill pass: the handful of lucide dots with fill="currentColor". */}
        <path fill={color} d={path.toD({ onlyFilled: true })} />
        {path.toSvg({
          style: shape.props.dash,
          strokeWidth,
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

  // indicator() is deprecated in 5.x; getIndicatorPath returning a Path2D is
  // the supported surface, and PathBuilder.toPath2D satisfies it directly.
  override getIndicatorPath(shape: IconShape): Path2D | undefined {
    return getIconPath(shape).toPath2D({
      style: shape.props.dash === "draw" ? "draw" : "solid",
      strokeWidth: 1,
      passes: 1,
      randomSeed: shape.id,
      offset: 0,
      roundness: 1,
    });
  }
}

export const ICON_NAMES = Object.keys(ICONS).sort();
export { ICONS };
