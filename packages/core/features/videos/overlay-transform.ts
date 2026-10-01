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
import {
  easeOverlayTransformProgress,
  easeStatements,
  exact,
  fmt,
} from "./overlay-transform-ease.js";

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
 * What the camera move RENDERS AS — bumped whenever this file starts putting
 * the footage somewhere it did not put it before.
 *
 * An export is content-addressed: a Video whose address has not changed is not
 * re-exported, whatever the code now does. So a fix to the move that leaves the
 * address alone reaches every Video EXCEPT the ones that already have the bug
 * baked into a file. This constant is how the address is told.
 *
 * It is not `EXPORT_VERSION`. That one re-exports the whole library; this is
 * carried only by an Overlay whose Kind actually moves the camera, so a Video
 * with nothing but Definition Cards keeps the address it has and is not
 * re-encoded to produce the bytes it already has.
 *
 * - 1 — the first move to ship.
 * - 2 — the ease became exact and the footage started reading it on the
 *   content's own frame grid. Up to 38px of the move landed on a different
 *   frame from the panel before this.
 */
export const OVERLAY_CAMERA_VERSION = 2;

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

/** The framing partway through a move: `0` is `from`, `1` is `to`. */
const overlayTransformFramingAt = (
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
 * The frame rate an Overlay's own CONTENT is rendered at.
 *
 * The camera has to know it. A Bullet Panel is not drawn live alongside the
 * footage — it is a CLIP, rendered at this rate, and a clip can only ever show
 * whole frames. Whatever the moment, what is actually on screen is the frame
 * whose own time has most recently passed, up to a frame stale. The footage
 * has no such grid: left alone, it slides continuously and runs ahead of the
 * panel by as much as a whole frame's travel — 38px at the fastest part of the
 * ease, which is a visible slip on an opaque edge.
 *
 * So the camera is sampled on the panel's grid too (see {@link sampledTime}).
 * The two are then not merely following the same curve, they are reading it at
 * the same instants.
 *
 * `packages/core` cannot import the renderer's own copy of this number
 * (`OVERLAY_RENDER_FPS` in `apps/local`) without depending on it, so it is
 * repeated here and held equal by a test in `apps/local`, which imports both —
 * the same arrangement `BULLET_PANEL_ANIMATION_IN_SECONDS` already has.
 */
export const OVERLAY_CONTENT_FPS = 60;

/**
 * A nanosecond of slack on the frame boundary.
 *
 * The same moment reaches this arithmetic on two different clocks — the
 * flattened Video's for the export, the Clip's own (with a NEGATIVE start for
 * an Overlay that spilled onto it) for the editor — and subtracting two
 * different pairs of doubles does not always land on the same side of a frame
 * boundary. Without this, one surface takes frame 11 where the other takes 12,
 * and the footage jumps a frame's worth of travel against the panel. A moment
 * within a nanosecond of a boundary is that frame; nothing downstream can
 * resolve finer.
 */
const FRAME_EPSILON = 1e-9;

/**
 * How far past its start the Overlay's camera is really read: the ELAPSED
 * seconds, snapped back to the frame of the Overlay's content on screen at
 * them.
 *
 * FLOOR, not round, and that is measured rather than assumed: ffmpeg's
 * `overlay` shows the most recent frame of the graphic whose presentation time
 * has passed, so `floor` names the frame the export actually composites. The
 * editor's preview seeks its `<Player>` the same way for the same reason.
 *
 * Elapsed, never an absolute moment, so the answer cannot depend on which
 * clock the caller states its window on.
 */
const sampledElapsed = (
  window: OverlayTransformWindow,
  timeInSeconds: number
): number =>
  Math.floor(
    (timeInSeconds - window.startInSeconds) * OVERLAY_CONTENT_FPS +
      FRAME_EPSILON
  ) / OVERLAY_CONTENT_FPS;

/**
 * How far into the move the camera is at a given moment on the timeline.
 *
 * The same arithmetic the emitted `crop` expression performs, in TypeScript:
 * the nearer end's ramp, read on the content's frame grid, eased. Outside the
 * window there is no move at all, which is what the two nodes composing to an
 * identity gives without a gate.
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
  const elapsed = sampledElapsed(window, timeInSeconds);
  const span = window.endInSeconds - window.startInSeconds;
  const { enter, exit } = easeDurations(window);
  const ramp = (remaining: number, duration: number) =>
    duration === 0 ? 1 : Math.min(1, Math.max(0, remaining / duration));
  return easeOverlayTransformProgress(
    Math.min(ramp(elapsed, enter), ramp(span - elapsed, exit))
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
 * The head of the `crop` expression: the moment into slot 1, progress into
 * slot 2, and the offset it implies into slot 3.
 *
 * Slot 1 is `t` snapped back to the frame grid of the Overlay's own content —
 * {@link sampledTime}, in ffmpeg — so the footage is read at the instant the
 * panel frame beside it was drawn for. Without it the footage slides smoothly
 * past a panel that can only step, and leads it by up to a frame's travel.
 *
 * The two ends are reduced to ONE ramp before being eased, rather than eased
 * separately and then compared. The curve is monotonic, so
 * `min(ease(a), ease(b))` and `ease(min(a, b))` are the same number, and only
 * the second spells the ease out once.
 *
 * A disabled end contributes the constant `1` to that `min` — the camera is
 * simply already there — and that, and nothing else, is what makes it a cut.
 */
const progressPrelude = (
  transform: OverlayTransform,
  window: OverlayTransformWindow
): string => {
  const { enter, exit } = easeDurations(window);
  const fps = exact(OVERLAY_CONTENT_FPS);
  // Slot 1 is the ELAPSED seconds, on the content's frame grid — the same two
  // rules {@link sampledElapsed} follows, for the same reasons.
  const grid =
    `st(1,floor((t-${fmt(window.startInSeconds)})*${fps}` +
    `+${exact(FRAME_EPSILON)})/${fps});`;
  const span = window.endInSeconds - window.startInSeconds;
  const ramps = [
    enter === 0 ? fmt(1) : `clip(ld(1)/${fmt(enter)},0,1)`,
    exit === 0 ? fmt(1) : `clip((${fmt(span)}-ld(1))/${fmt(exit)},0,1)`,
  ];

  const progress =
    enter === 0 && exit === 0
      ? `st(2,${fmt(1)});`
      : `${grid}st(0,min(${ramps[0]},${ramps[1]}));${easeStatements()}`;

  return (
    progress +
    `st(3,lerp(${exact(transform.from.offsetX)},` +
    `${exact(transform.to.offsetX)},ld(2)));`
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
  const sourceWidth = `iw/${exact(widened)}`;

  const pad = [
    `pad=w='iw*${exact(widened)}'`,
    `h='ih'`,
    `x='iw*${exact(padLeft)}'`,
    `y='0'`,
    `color=${SLIDE_BACKGROUND_COLOR}`,
  ].join(":");

  // NO `eval=` OPTION. ffmpeg 6.0 removed it from `crop` and evaluates `x`
  // and `y` on every frame instead, so asking for `eval=frame` is not merely
  // needless — it is refused, and the whole compositing pass dies with it.
  const crop = [
    `crop=w='${sourceWidth}'`,
    `h='ih'`,
    `x='${prelude}(${sourceWidth})*(${exact(padLeft)}-ld(3))'`,
    `y='0'`,
  ].join(":");

  return `${pad},${crop}`;
};

/**
 * Re-exported so the ease stays part of THIS feature's surface. Callers ask
 * `overlay-transform` for the camera's easing; that it is worked out next door
 * (`./overlay-transform-ease.ts`) is this feature's business, not theirs.
 */
export { easeOverlayTransformProgress };
