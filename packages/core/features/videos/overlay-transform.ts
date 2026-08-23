/**
 * Overlay Transform — the camera move an Overlay's KIND asks for.
 *
 * A Clip Zoom (see {@link ./clip-zoom.ts}) is one static rect for a whole
 * Clip. A Transform is the other shape of the same idea: a PAIR of rects and a
 * move between them, scoped to one Overlay's own window rather than a Clip, so
 * the footage can pull aside for a panel and come back when the panel goes.
 *
 * Nobody authors it. An Overlay carries no keyframes and the CLI has no flag
 * for them: the move is looked up from the Overlay's `kind`, so creating a
 * `bulletPanel` is all it takes to get the panel and the camera move together,
 * in sync, every time. {@link OVERLAY_TRANSFORMS} is a
 * `Record<OverlayKind, …>`, so a third content-kind is a compile error here
 * until somebody says whether it moves the camera.
 *
 * The geometry is deliberately Clip Zoom's — the same fractional
 * {@link ClipZoomRect}, formatted into the same `crop` arithmetic — so the two
 * features cannot drift into disagreeing about what "scale 1.3 around
 * (0.62, 0.4)" frames. The two must never be applied to the same footage
 * though: `cvm overlay add` refuses a Transform-carrying Overlay whose window
 * lands on a zoomed Clip rather than compounding the two crops.
 */

import type { ClipZoomRect } from "./clip-zoom.js";
import { resolveOverlayKind, type OverlayKind } from "./overlay-kind.js";

/**
 * A camera move: where the framing starts and where it arrives. Both ends are
 * {@link ClipZoomRect}s, fractional and so resolution-independent.
 */
export type OverlayTransform = {
  readonly from: ClipZoomRect;
  readonly to: ClipZoomRect;
};

/** How the camera is already framed: the centred shot Matt records. */
const CENTERED: ClipZoomRect = { scale: 1, originX: 0.5, originY: 0.5 };

/**
 * The move each content-kind asks for, or `null` for a kind that draws over
 * untouched footage (which is every kind but `bulletPanel` today).
 *
 * BALLPARK, NOT FINAL. `bulletPanel`'s end rect — 130% around (0.62, 0.4) —
 * pushes the face right and slightly up to clear the left third of frame for
 * the panel, and was picked by arithmetic rather than by looking at a render.
 * It is expected to be tuned against real footage; that tuning is a one-line
 * edit here, and it moves the preview, the export and nothing else, because
 * every consumer reads the rect from this table and nowhere else.
 */
const OVERLAY_TRANSFORMS: Record<OverlayKind, OverlayTransform | null> = {
  definitionCard: null,
  bulletPanel: {
    from: CENTERED,
    to: { scale: 1.3, originX: 0.62, originY: 0.4 },
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
 * How long the camera takes to arrive, and to leave again: long enough to read
 * as a deliberate move rather than a jump cut, short enough that the panel's
 * first bullet is not waiting on it.
 *
 * Shared with the panel content's own enter/exit in the renderer, so the two
 * halves of the same moment cannot desync.
 */
export const OVERLAY_TRANSFORM_EASE_IN_SECONDS = 0.35;

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
export const overlayTransformRectAt = (
  transform: OverlayTransform,
  progress: number
): ClipZoomRect => {
  const p = Math.min(1, Math.max(0, progress));
  const mix = (from: number, to: number) => from + (to - from) * p;
  return {
    scale: mix(transform.from.scale, transform.to.scale),
    originX: mix(transform.from.originX, transform.to.originX),
    originY: mix(transform.from.originY, transform.to.originY),
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
 * The exact twin of {@link overlayTransformCropFilter}, exactly as
 * `clipZoomCssStyle` is the twin of `clipZoomCropFilter`: both read the
 * same rect from {@link OVERLAY_TRANSFORMS} and both put it through the same
 * eased progress, so the editor preview cannot disagree with what the Publish
 * ships. The filter varies with `t` inside ONE node; the preview is re-asked
 * once per playhead update instead, which is why the moment is a parameter
 * here rather than a variable in an expression.
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
): { transform: string; transformOrigin: string } | null => {
  const transform = overlayTransform(overlay.kind);
  if (!transform) return null;
  if (!(overlay.endInSeconds > overlay.startInSeconds)) return null;
  if (
    timeInSeconds < overlay.startInSeconds ||
    timeInSeconds > overlay.endInSeconds
  ) {
    return null;
  }

  const rect = overlayTransformRectAt(
    transform,
    overlayTransformProgressAt(overlay, timeInSeconds)
  );

  return {
    transform: `scale(${rect.scale})`,
    transformOrigin: `${rect.originX * 100}% ${rect.originY * 100}%`,
  };
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
 * The shared head of all four `crop` expressions: progress into slot 2, and
 * the scale it implies into slot 3.
 *
 * ffmpeg evaluates each of `w`/`h`/`x`/`y` in its own variable context, so the
 * head has to be repeated in each rather than computed once — which is why the
 * two ends are reduced to ONE ramp before being eased, rather than eased
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
    `st(3,lerp(${fmt(transform.from.scale)},${fmt(transform.to.scale)},ld(2)));`
  );
};

/**
 * The `crop` filter that performs an Overlay's camera move, or `null` for an
 * Overlay whose kind moves no camera.
 *
 * The geometry is {@link clipZoomCropFilter}'s, in ffmpeg's own `iw`/`ih`
 * terms so it is right for whatever the source is — only every term is now a
 * function of `t`, which is what `eval=frame` asks ffmpeg to honour. The node
 * is gated with the same `enable='between(t,…)'` idiom the graphic overlay
 * chain uses, so outside its window the filter is bypassed entirely and the
 * frame passes through at its own size.
 */
export const overlayTransformCropFilter = (
  overlay: OverlayTransformWindow & { readonly kind?: string | null }
): string | null => {
  const transform = overlayTransform(overlay.kind);
  if (!transform) return null;
  if (!(overlay.endInSeconds > overlay.startInSeconds)) return null;

  const prelude = progressPrelude(transform, overlay);
  const origin = (from: number, to: number) =>
    `lerp(${fmt(from)},${fmt(to)},ld(2))`;

  return [
    `crop=w='${prelude}iw/ld(3)'`,
    `h='${prelude}ih/ld(3)'`,
    `x='${prelude}(iw-iw/ld(3))*${origin(transform.from.originX, transform.to.originX)}'`,
    `y='${prelude}(ih-ih/ld(3))*${origin(transform.from.originY, transform.to.originY)}'`,
    `eval=frame`,
    `enable='between(t,${fmt(overlay.startInSeconds)},${fmt(overlay.endInSeconds)})'`,
  ].join(":");
};
