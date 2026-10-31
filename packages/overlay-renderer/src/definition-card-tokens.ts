/**
 * The Definition Card's design tokens: its type, colours, radius and shadow.
 *
 * One module so anything that should look like an Overlay — the Definition
 * Card itself, and the stream's Chat Highlight card — reads the same values
 * and the styles can't drift.
 *
 * Plain data only: no Remotion or React import, so a Node process can read it.
 * Sizes are in pixels against a 1920-wide frame; multiply by
 * `frameWidth / DESIGN_WIDTH` to draw at another resolution.
 */

/** The reference frame width every size here is authored against. */
export const DESIGN_WIDTH = 1920;

/**
 * DM Sans is AI Hero's brand typeface. The Remotion components load it through
 * `@remotion/google-fonts`, so a render never depends on a system font.
 */
export const FONT_FAMILY = "DM Sans";

/** The title: bold white, Tailwind's `leading-tight`. */
export const TITLE_TYPE = {
  fontSize: 36,
  fontWeight: 700,
  lineHeight: 1.25,
} as const;

/** The body text under the title: regular weight, Tailwind's `leading-snug`. */
export const BODY_TYPE = {
  fontSize: 26,
  fontWeight: 400,
  lineHeight: 1.375,
} as const;

export const COLORS = {
  /**
   * The panel's own ground. Tldraw's dark canvas, `hsl(240, 5%, 6.5%)` — the
   * same near-black the Bullet Panel's ground and the course diagrams use, so
   * every dark surface in an Overlay shares one colour rather than each
   * picking a near-black of its own.
   */
  panel: "#101011",
  title: "#FFFFFF",
  /** Stone-300: one step back from the title's white, the same pairing the
   *  Bullet Panel's body text uses against its own dark ground. */
  body: "#D6D3D1",
  /** Amber-200: the brand bar down the panel's left edge. */
  accentBar: "#FDE68A",
  /** Amber-400. Reads as the brand accent on the dark panel same as it did on white. */
  underline: "#FBBF24",
} as const;

/** The amber brand bar's width down the panel's left edge. */
export const ACCENT_BAR_WIDTH = 8;

/**
 * The panel's corner radii. The left corners are barely rounded, so the amber
 * accent bar reads as a straight bar rather than a crescent.
 */
export const RADIUS = {
  left: 8,
  right: 24,
} as const;

/**
 * The panel's drop shadow. It is applied as a `drop-shadow` filter on a
 * wrapper, not a box-shadow on the panel: a box-shadow lies outside the
 * panel's border box, so the panel's own overflow clip would cut it off.
 */
export const SHADOW = {
  offsetY: 10,
  blur: 24,
  color: "rgba(28,25,23,0.3)",
} as const;
