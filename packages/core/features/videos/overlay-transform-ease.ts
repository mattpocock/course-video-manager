/**
 * The Overlay Transform's EASE — one curve, written twice.
 *
 * It sits in its own module because it is the one thing the editor's preview
 * and the exported file have to agree about EXACTLY. Both surfaces slide the
 * same footage the same distance; what took them apart was reading the curve
 * between the two ends differently. The preview solved it; the export sampled
 * it as eight straight segments and ran up to 18px ahead of the panel it was
 * moving with.
 *
 * So the curve is defined once, here, and emitted twice: as
 * {@link easeOverlayTransformProgress} for anything that can call a function,
 * and as {@link easeStatements} for ffmpeg, which cannot. They are the same
 * formula and the same constants, and a test in `overlay-transform.test.ts`
 * holds them to the same value at every point of the move.
 *
 * The number formatters live here too, because which of the two a number takes
 * is a fact about this arithmetic rather than about any caller.
 */

/**
 * The easing curve, as control points: `cubic-bezier(0.25, 0.1, 0.25, 1)` —
 * CSS's `ease`, and the exact curve `Easing.bezier(0.25, 0.1, 0.25, 1)` already
 * gives the Subtitle overlay's slide in the Remotion renderer. It is spelled
 * out here rather than imported because `packages/core` does not (and should
 * not) depend on Remotion; the numbers are the contract.
 *
 * `x1 === x2` is LOAD-BEARING and not a matter of taste. It is what collapses
 * the curve's x axis into a cubic that can be inverted in closed form — in
 * TypeScript AND in ffmpeg's expression language, which has no solver and no
 * way to loop. See {@link easeOverlayTransformProgress}. Move one x control
 * point off the other and the export goes back to APPROXIMATING this curve
 * while the preview computes it, which is exactly how the two came to disagree
 * about where the footage was. A test holds them equal.
 */
const EASE_CONTROL_POINTS = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } as const;

/** One axis of a unit cubic Bézier, whose first and last points are 0 and 1. */
const bezierAxis = (s: number, p1: number, p2: number): number =>
  3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;

/**
 * The curve's x axis, inverted — the three constants Cardano's formula needs.
 *
 * With `x1 === x2 === c` the x axis collapses from a general cubic Bézier to
 * `x = s³ - 3c·s² + 3c·s`, and substituting `s = u + c` kills the square term
 * outright, leaving the depressed cubic `u³ + Pu + (Q0 - x) = 0`. Its
 * discriminant is positive for every `c` in `(0, 1)`, so there is exactly ONE
 * real root and no branch to choose between.
 *
 * Derived from the control point rather than typed out, so retuning the curve
 * along `x1 === x2` stays a one-line edit.
 */
const EASE_C = EASE_CONTROL_POINTS.x1;
const EASE_P = 3 * EASE_C * (1 - EASE_C);
const EASE_Q0 = 3 * EASE_C * EASE_C - 2 * EASE_C * EASE_C * EASE_C;
const EASE_DISCRIMINANT = (EASE_P / 3) ** 3;

/**
 * The eased value of a 0..1 ramp. EXACT — no search, no approximation.
 *
 * This used to bisect for `s`, because a cubic Bézier gives x and y in terms of
 * a parameter rather than y in terms of x. Bisection was accurate enough here
 * and impossible in ffmpeg, so the export shipped a piecewise-linear SAMPLE of
 * this same curve — and drifted up to 18px away from the panel that was meant
 * to be moving with it.
 *
 * So the inverse is taken in closed form instead (see {@link EASE_C}), which
 * both sides can evaluate: this function, and the expression
 * {@link easeStatements} emits. Same formula, same constants, two languages —
 * which is the only way the two surfaces can be in step at every instant rather
 * than only at the ends.
 */
export const easeOverlayTransformProgress = (ramp: number): number => {
  const x = Math.min(1, Math.max(0, ramp));
  if (x === 0 || x === 1) return x;

  const q = EASE_Q0 - x;
  const root = Math.sqrt((q * q) / 4 + EASE_DISCRIMINANT);
  // `root >= |q| / 2`, so both cube roots are of a non-negative number — which
  // is what lets ffmpeg spell them as `pow(…, 1/3)`, having no `cbrt`.
  const s = Math.cbrt(root - q / 2) - Math.cbrt(root + q / 2) + EASE_C;

  const { y1, y2 } = EASE_CONTROL_POINTS;
  return Math.min(1, Math.max(0, bezierAxis(s, y1, y2)));
};

/**
 * Numbers as the filter graph spells them: fixed notation, never exponential,
 * for the same reason `overlay-compositing.ts` formats seconds that way —
 * ffmpeg's expression parser reads `1e-7` as an identifier minus a number.
 */
export const fmt = (value: number): string => value.toFixed(6);

/**
 * A number of the MOVE — a constant of the ease, or a fraction of the frame —
 * spelled to its full precision.
 *
 * {@link fmt} rounds to six places, which is right for a moment in seconds and
 * wrong for these. The ease's constants feed a cube root, where a rounded input
 * moves the whole curve rather than the last decimal of one number. The
 * geometry is worse: `812 / 1920` at six places is a DIFFERENT number from the
 * one the preview slides by, so the two surfaces would settle a thousandth of a
 * pixel apart for no reason at all, and no test could then assert that they
 * agree exactly. They are all plain fractions near 1, so fixed notation is
 * still safe.
 */
export const exact = (value: number): string =>
  value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");

/**
 * The ease, as ffmpeg statements: a 0..1 ramp in slot 0, the eased value out
 * in slot 2.
 *
 * This is {@link easeOverlayTransformProgress}, term for term, in the other
 * language — Cardano's one real root, then the curve's y axis at the `s` it
 * found. Slots 4, 5 and 6 hold `q`, the discriminant's root, and `s`.
 *
 * ffmpeg has no `cbrt`, only `pow`, which will not take a negative base to a
 * fractional power. It does not have to: `root >= |q| / 2` makes both bases
 * non-negative, and the sign is carried by SUBTRACTING the second cube root
 * rather than adding it.
 *
 * It used to be a piecewise-linear ladder of eight `if`/`lerp` segments,
 * because a Bézier was thought to have no closed-form inverse. It has one when
 * its two x control points agree, which this curve's do (see
 * {@link EASE_CONTROL_POINTS}). The ladder cost up to 18px of drift against a
 * panel drawn from the real curve; this costs none.
 */
export const easeStatements = (): string => {
  const { y1, y2 } = EASE_CONTROL_POINTS;
  const s = "ld(6)";
  const y =
    `${exact(3 * y1)}*(1-${s})*(1-${s})*${s}` +
    `+${exact(3 * y2)}*(1-${s})*${s}*${s}` +
    `+${s}*${s}*${s}`;

  return (
    `st(4,${exact(EASE_Q0)}-ld(0));` +
    `st(5,sqrt(ld(4)*ld(4)/4+${exact(EASE_DISCRIMINANT)}));` +
    `st(6,pow(ld(5)-ld(4)/2,1/3)-pow(ld(5)+ld(4)/2,1/3)+${exact(EASE_C)});` +
    `st(2,clip(${y},0,1));`
  );
};
