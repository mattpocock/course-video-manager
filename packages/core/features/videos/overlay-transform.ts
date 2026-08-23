/**
 * Overlay Transform — the camera move an Overlay's KIND asks for.
 *
 * A Clip Zoom (see {@link ./clip-zoom.ts}) is a static CROP of a whole Clip: it
 * throws source away and magnifies what is left. A Transform is the other
 * thing entirely — a pure SLIDE. The footage keeps its own scale to the pixel
 * and simply travels sideways in frame, scoped to one Overlay's own window, so
 * it can move aside for a panel and come back when the panel goes.
 *
 * NO ZOOM, EVER. The source footage is never magnified by a Transform, and
 * that is the point rather than an accident of the numbers: a presenter shot
 * that grows when a panel arrives reads as a cut to a different framing. A
 * shot that slides reads as the frame making room. So a Transform's two ends
 * are one number each — how far right the footage sits — and there is no
 * scale, and no origin, to get wrong.
 *
 * Nobody authors it. An Overlay carries no keyframes and the CLI has no flag
 * for them: the move is looked up from the Overlay's `kind`, so creating a
 * `bulletPanel` is all it takes to get the panel and the camera move together,
 * in sync, every time. {@link OVERLAY_TRANSFORMS} is a
 * `Record<OverlayKind, …>`, so a third content-kind is a compile error here
 * until somebody says whether it moves the camera.
 *
 * A Transform and a Clip Zoom are still never applied to the same footage:
 * `cvm overlay add` refuses a Transform-carrying Overlay whose window lands on
 * a zoomed Clip.
 */

import { resolveOverlayKind, type OverlayKind } from "./overlay-kind.js";

/**
 * Where the footage sits in frame: `offsetX` is how far RIGHT it has travelled
 * from where it was filmed, as a fraction of the frame's own width, so it is
 * resolution-independent. `0` is untouched; `0.25` has the footage a quarter of
 * a frame to the right, with its left quarter now empty and its right quarter
 * pushed off the edge.
 *
 * One number, because a Transform slides and never zooms. There is deliberately
 * no `scale` and no vertical partner: adding either would let a Transform do
 * the thing this feature exists not to do.
 */
export type OverlayFraming = {
  readonly offsetX: number;
};

/** A camera move: where the footage starts and where it arrives. */
export type OverlayTransform = {
  readonly from: OverlayFraming;
  readonly to: OverlayFraming;
};

/** How the camera is already framed: the shot Matt filmed, unmoved. */
const CENTERED: OverlayFraming = { offsetX: 0 };

/**
 * How far a Bullet Panel slides the footage right: HALF the width of the panel's
 * own opaque ground, 406 of 1920 (the ground is 812 — `GROUND_WIDTH` in the
 * renderer's `BulletPanel.tsx`).
 *
 * Half, because the thing that must end up centred is the PRESENTER, in the
 * block of frame the panel leaves. Slide by half of what you cover and the
 * source's own middle lands in the middle of what is left, at any panel width:
 * the block runs from the panel's right edge to the frame's, so its centre sits
 * half a panel to the right of the frame's centre, which is exactly how far the
 * footage has come.
 *
 * So the panel DOES stand on the footage rather than beside it, and that is
 * intended. Sliding the whole 812 makes the two edges meet and hides no pixel
 * of the shot, but it throws the face out to the right of the space it has —
 * the earlier framing, and the one this replaces. The ground is opaque, so what
 * it stands on costs nothing.
 *
 * TUNING: by eye, against the Studio. It went from the full ground width to
 * half of it.
 */
const BULLET_PANEL_OFFSET_X = 812 / 2 / 1920;

/**
 * The move each content-kind asks for, or `null` for a kind that draws over
 * untouched footage (which is every kind but `bulletPanel` today).
 *
 * Tuning is a one-line edit here, and it moves the preview, the export and
 * nothing else, because every consumer reads the framing from this table and
 * nowhere else.
 */
const OVERLAY_TRANSFORMS: Record<OverlayKind, OverlayTransform | null> = {
  definitionCard: null,
  bulletPanel: {
    from: CENTERED,
    to: { offsetX: BULLET_PANEL_OFFSET_X },
  },
};

/**
 * The move a raw `kind` column asks for, or `null` for none. Every consumer
 * goes through here, and through {@link resolveOverlayKind}, so a `kind`
 * nothing recognises moves no camera rather than throwing.
 */
export const overlayTransform = (
  kind: string | null | undefined
): OverlayTransform | null => OVERLAY_TRANSFORMS[resolveOverlayKind(kind)];

/**
 * How long the camera takes to arrive, and to leave again.
 *
 * THE one number for the speed of the whole moment. The panel sliding in and
 * the presenter's face moving right are not two animations that happen to
 * agree — they are one move seen twice, so they are one constant. Everything
 * that has to keep step with it derives from here:
 *
 * - the exported `crop`, formatted below;
 * - the editor player's CSS, formatted below from the same rect;
 * - the panel's own slide and its bullets' reveal, through
 *   `BULLET_PANEL_ANIMATION_IN_SECONDS` in `./bullet-panel.ts`, which is this
 *   constant under the name that file's callers know it by;
 * - the renderer's copy in `packages/overlay-renderer/src/props.ts`, which
 *   cannot import this one (the renderer must not depend on the domain
 *   database) and is instead held equal to it by a test in `apps/local` that
 *   imports both.
 *
 * Retuning the speed is therefore this line, and the renderer's, and nothing
 * else — and forgetting the renderer's fails a test rather than shipping a
 * panel that arrives before the camera does.
 *
 * TUNING: brought down by eye, against a real render. It started at two
 * seconds — long enough to watch the move rather than glimpse it — and came
 * down through one to 800ms.
 */
export const OVERLAY_TRANSFORM_EASE_IN_SECONDS = 0.8;

/**
 * The easing curve, as control points: `cubic-bezier(0.25, 0.1, 0.25, 1)` —
 * CSS's `ease`, and the exact curve `Easing.bezier(0.25, 0.1, 0.25, 1)` already
 * gives the Subtitle overlay's slide in the Remotion renderer. It is spelled
 * out here rather than imported because `packages/core` does not (and should
 * not) depend on Remotion; the numbers are the contract.
 */
const EASE_CONTROL_POINTS = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } as const;

/** One axis of a unit cubic Bézier, whose first and last points are 0 and 1. */
const bezierAxis = (s: number, p1: number, p2: number): number =>
  3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;

/**
 * The eased value of a 0..1 ramp.
 *
 * A cubic Bézier gives x and y in terms of a parameter, not y in terms of x,
 * and has no closed-form inverse — so x is solved for by bisection. Thirty
 * halvings is far past the precision of anything downstream (a frame, or six
 * decimal places in a filter string) and costs nothing: this runs a few dozen
 * times while a filter graph is being built, never per frame.
 */
export const easeOverlayTransformProgress = (ramp: number): number => {
  const target = Math.min(1, Math.max(0, ramp));
  if (target === 0 || target === 1) return target;

  const { x1, y1, x2, y2 } = EASE_CONTROL_POINTS;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (bezierAxis(mid, x1, x2) < target) low = mid;
    else high = mid;
  }
  return bezierAxis((low + high) / 2, y1, y2);
};

/** The framing partway through a move: `0` is `from`, `1` is `to`. */
export const overlayTransformFramingAt = (
  transform: OverlayTransform,
  progress: number
): OverlayFraming => {
  const p = Math.min(1, Math.max(0, progress));
  return {
    offsetX:
      transform.from.offsetX +
      (transform.to.offsetX - transform.from.offsetX) * p,
  };
};

/**
 * One Overlay's window on the flattened Video timeline, plus whether either
 * end of the move is meant to be a cut instead.
 *
 * The two flags live on the Overlay rather than in its content because they
 * govern the camera AND the content together — a camera that cuts while the
 * panel still eases in is the one combination nobody wants.
 */
export type OverlayTransformWindow = {
  readonly startInSeconds: number;
  readonly endInSeconds: number;
  readonly disableEnterAnimation?: boolean;
  readonly disableExitAnimation?: boolean;
};

/**
 * How long each end of the move actually gets.
 *
 * A disabled end gets none — the camera is simply already there, which is what
 * makes it a cut. An Overlay shorter than two eases splits what it has, so a
 * 0.4s Overlay eases in for 0.2s and straight back out rather than never
 * arriving at all.
 */
const easeDurations = (window: OverlayTransformWindow) => {
  const span = Math.max(0, window.endInSeconds - window.startInSeconds);
  const enters = !window.disableEnterAnimation;
  const exits = !window.disableExitAnimation;
  // Both ends have to fit inside the window; one end on its own may have all
  // of it. A shorter Overlay than that gets a proportionally quicker move
  // rather than a move that never arrives.
  const each = Math.min(
    OVERLAY_TRANSFORM_EASE_IN_SECONDS,
    enters && exits ? span / 2 : span
  );
  return { enter: enters ? each : 0, exit: exits ? each : 0 };
};

/**
 * How far into the move the camera is at a given moment on the timeline.
 *
 * The same arithmetic the emitted `crop` expression performs, in TypeScript:
 * the nearer end's ramp, eased. Outside the window there is no move at all,
 * which is what the filter's `enable` gate does by bypassing the node.
 */
export const overlayTransformProgressAt = (
  window: OverlayTransformWindow,
  timeInSeconds: number
): number => {
  if (
    timeInSeconds < window.startInSeconds ||
    timeInSeconds > window.endInSeconds
  ) {
    return 0;
  }
  const { enter, exit } = easeDurations(window);
  const ramp = (elapsed: number, duration: number) =>
    duration === 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration));
  return easeOverlayTransformProgress(
    Math.min(
      ramp(timeInSeconds - window.startInSeconds, enter),
      ramp(window.endInSeconds - timeInSeconds, exit)
    )
  );
};

// ---------------------------------------------------------------------------
// The preview half of the contract
// ---------------------------------------------------------------------------

/**
 * The framing an Overlay's camera move asks for at one moment, as CSS for the
 * Clip's `<video>` — or `null` for an Overlay whose kind moves no camera, and
 * for a moment outside the Overlay's own window.
 *
 * The exact twin of {@link overlayTransformVideoFilter}: both read the same
 * framing from {@link OVERLAY_TRANSFORMS} and both put it through the same
 * eased progress, so the editor preview cannot disagree with what the Publish
 * ships. The filter varies with `t` inside one node; the preview is re-asked
 * once per playhead update instead, which is why the moment is a parameter
 * here rather than a variable in an expression.
 *
 * A `translateX` and NOT a `scale`: the percentage is of the element's own
 * width, which is the whole frame, so it is the same fraction the export
 * slides by. The `<video>` keeps every pixel at the size it was filmed, and
 * the space it leaves behind shows whatever the player draws underneath.
 *
 * `timeInSeconds` is read on whatever clock the window is stated on. The
 * export states both on the flattened Video timeline; the editor states both
 * against the Clip that is playing, including the negative `startInSeconds` an
 * Overlay spilling from an earlier Clip has. Only the difference between the
 * two is ever used, so either clock gives the same framing.
 */
export const overlayTransformCssStyleAt = (
  overlay: OverlayTransformWindow & { readonly kind?: string | null },
  timeInSeconds: number
): { transform: string } | null => {
  const transform = overlayTransform(overlay.kind);
  if (!transform) return null;
  if (!(overlay.endInSeconds > overlay.startInSeconds)) return null;
  if (
    timeInSeconds < overlay.startInSeconds ||
    timeInSeconds > overlay.endInSeconds
  ) {
    return null;
  }

  const framing = overlayTransformFramingAt(
    transform,
    overlayTransformProgressAt(overlay, timeInSeconds)
  );

  return { transform: `translateX(${framing.offsetX * 100}%)` };
};

// ---------------------------------------------------------------------------
// The ffmpeg half of the contract
// ---------------------------------------------------------------------------

/**
 * Numbers as the filter graph spells them: fixed notation, never exponential,
 * for the same reason `overlay-compositing.ts` formats seconds that way —
 * ffmpeg's expression parser reads `1e-7` as an identifier minus a number.
 */
const fmt = (value: number): string => value.toFixed(6);

/**
 * How many straight segments the eased curve is approximated by.
 *
 * ffmpeg's expression language has no cubic-Bézier solver and no way to define
 * a function, so the curve is SAMPLED here and emitted as a piecewise-linear
 * `if`/`lerp` ladder. Eight segments hold the curve to well under a pixel of
 * error at these scales, and the ladder stays short enough to read.
 */
const EASE_SEGMENTS = 8;

/**
 * The eased value of `argExpr` (a 0..1 ramp) as an ffmpeg expression.
 *
 * `argExpr` is repeated twice per segment, so callers pass a cheap one — an
 * `ld(n)` slot rather than the arithmetic that filled it.
 */
const easeExpression = (argExpr: string): string => {
  let expression = fmt(1);
  for (let segment = EASE_SEGMENTS - 1; segment >= 0; segment--) {
    const from = segment / EASE_SEGMENTS;
    const to = (segment + 1) / EASE_SEGMENTS;
    expression =
      `if(lt(${argExpr},${fmt(to)}),` +
      `lerp(${fmt(easeOverlayTransformProgress(from))},` +
      `${fmt(easeOverlayTransformProgress(to))},` +
      `(${argExpr}-${fmt(from)})/${fmt(1 / EASE_SEGMENTS)}),` +
      `${expression})`;
  }
  return expression;
};

/**
 * The head of the `crop` expression: progress into slot 2, and the offset it
 * implies into slot 3.
 *
 * The two ends are reduced to ONE ramp before being eased, rather than eased
 * separately and then compared. The curve is monotonic, so
 * `min(ease(a), ease(b))` and `ease(min(a, b))` are the same number, and only
 * the second spells the ladder out once.
 *
 * A disabled end contributes the constant `1` to that `min` — the camera is
 * simply already there — and that, and nothing else, is what makes it a cut.
 */
const progressPrelude = (
  transform: OverlayTransform,
  window: OverlayTransformWindow
): string => {
  const { enter, exit } = easeDurations(window);
  const ramps = [
    enter === 0
      ? fmt(1)
      : `clip((t-${fmt(window.startInSeconds)})/${fmt(enter)},0,1)`,
    exit === 0
      ? fmt(1)
      : `clip((${fmt(window.endInSeconds)}-t)/${fmt(exit)},0,1)`,
  ];

  const progress =
    enter === 0 && exit === 0
      ? `st(2,${fmt(1)});`
      : `st(0,min(${ramps[0]},${ramps[1]}));st(2,${easeExpression("ld(0)")});`;

  return (
    progress +
    `st(3,lerp(${fmt(transform.from.offsetX)},${fmt(transform.to.offsetX)},ld(2)));`
  );
};

/**
 * What the empty frame a slide opens up is filled with.
 *
 * Near-black rather than pure black, because the Bullet Panel's own ground is
 * `#101011` and sweeps across exactly this space: for the fraction of a second
 * during the ease when the footage has moved further than the ground has, the
 * band between them should read as the panel arriving, not as a hole in the
 * picture. It is a plain constant and not an import — `packages/core` must not
 * depend on the renderer — and nothing breaks if the two drift, because both
 * are near-black on a moving edge.
 */
const SLIDE_BACKGROUND_COLOR = "#101011";

/**
 * The filter chain that performs an Overlay's camera move, or `null` for an
 * Overlay whose kind moves no camera.
 *
 * A slide cannot be a crop. A crop can only choose a window INSIDE the source,
 * so the only way it moves the picture sideways is by first magnifying it to
 * make room — which is the zoom this feature exists to avoid. So the chain is
 * two nodes instead:
 *
 * 1. a STATIC `pad` that widens the canvas by the move's own travel, putting
 *    the untouched picture in the middle of a wider frame;
 * 2. an ANIMATED `crop` that takes an original-sized window back out of it, at
 *    an `x` that walks left as the footage is meant to travel right.
 *
 * The output is the source's own size on every frame, and every pixel of the
 * picture that survives is at the scale it was filmed at — the pair only ever
 * copies, never resamples.
 *
 * NO `enable=` GATE, deliberately. Outside the Overlay's window the ramps in
 * {@link progressPrelude} already evaluate to `0`, so the crop lands exactly
 * on the padded picture and the two nodes compose to an identity. Gating would
 * have to gate BOTH — a bypassed `crop` behind a live `pad` emits a wider
 * frame than the graph expects — and `pad` does not support timeline editing
 * in every ffmpeg build. An identity by construction needs no gate.
 */
export const overlayTransformVideoFilter = (
  overlay: OverlayTransformWindow & { readonly kind?: string | null }
): string | null => {
  const transform = overlayTransform(overlay.kind);
  if (!transform) return null;
  if (!(overlay.endInSeconds > overlay.startInSeconds)) return null;

  // How much empty frame the move needs on each side, as a fraction of the
  // SOURCE's width: a rightward slide opens space on the left, a leftward one
  // on the right, and an end that never leaves centre asks for neither.
  const offsets = [transform.from.offsetX, transform.to.offsetX];
  const padLeft = Math.max(0, ...offsets);
  const padRight = Math.max(0, ...offsets.map((offset) => -offset));
  // The padded canvas, as a multiple of the source's width. Inside `crop` this
  // is the divisor that recovers the source's own width from `iw`, because by
  // then `iw` is the PADDED width.
  const widened = 1 + padLeft + padRight;

  const prelude = progressPrelude(transform, overlay);
  const sourceWidth = `iw/${fmt(widened)}`;

  const pad = [
    `pad=w='iw*${fmt(widened)}'`,
    `h='ih'`,
    `x='iw*${fmt(padLeft)}'`,
    `y='0'`,
    `color=${SLIDE_BACKGROUND_COLOR}`,
  ].join(":");

  const crop = [
    `crop=w='${sourceWidth}'`,
    `h='ih'`,
    `x='${prelude}(${sourceWidth})*(${fmt(padLeft)}-ld(3))'`,
    `y='0'`,
    `eval=frame`,
  ].join(":");

  return `${pad},${crop}`;
};
