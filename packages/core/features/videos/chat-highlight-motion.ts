import { cubicBezierEase } from "./overlay-transform-ease.js";

/**
 * THE CHAT HIGHLIGHT'S MOTION (spec #2445, stories 73–75): its constants in
 * one place, for the Live Stream's card feed now and the editor preview and a
 * `chatHighlight` Overlay later, so the three can never move differently.
 * Matt's spec ("something Emil Kowalski would design"): the card rises 12 px
 * and fades in over 250 ms on a strong ease-out, and leaves over 150 ms on an
 * ease-in, fading and dropping 6 px. No bounce, no overshoot: both curves stay
 * inside 0..1.
 */
export const CHAT_HIGHLIGHT_MOTION = {
  enter: {
    ms: 250,
    /** It starts this far below where it settles. */
    risePx: 12,
    ease: cubicBezierEase({ x1: 0.23, y1: 1, x2: 0.32, y2: 1 }),
  },
  exit: {
    ms: 150,
    /** It ends this far below where it was. */
    dropPx: 6,
    ease: cubicBezierEase({ x1: 0.42, y1: 0, x2: 1, y2: 1 }),
  },
} as const;

/** The most the card is ever below its settled place: the room a canvas needs. */
export const CHAT_HIGHLIGHT_TRAVEL_PX = CHAT_HIGHLIGHT_MOTION.enter.risePx;

/** The card on one frame: how opaque, and how many pixels below its settled place. */
export type ChatHighlightPose = { opacity: number; offsetY: number };

export const CHAT_HIGHLIGHT_HIDDEN: ChatHighlightPose = {
  opacity: 0,
  offsetY: CHAT_HIGHLIGHT_MOTION.enter.risePx,
};

/** `ms` into its entrance: from wherever it was (`from`), up to settled. */
export const enteringPose = (
  ms: number,
  from: ChatHighlightPose = CHAT_HIGHLIGHT_HIDDEN
): ChatHighlightPose => {
  const { enter } = CHAT_HIGHLIGHT_MOTION;
  const e = enter.ease(ms / enter.ms);
  return {
    opacity: from.opacity + (1 - from.opacity) * e,
    offsetY: from.offsetY * (1 - e),
  };
};

/** `ms` into its exit: from wherever it was (`from`), faded out and dropped. */
export const exitingPose = (
  ms: number,
  from: ChatHighlightPose
): ChatHighlightPose => {
  const { exit } = CHAT_HIGHLIGHT_MOTION;
  const e = exit.ease(ms / exit.ms);
  return {
    opacity: from.opacity * (1 - e),
    offsetY: from.offsetY + exit.dropPx * e,
  };
};

/**
 * THE CHAT SPIN (spec #2551): a Chat Card's slot-machine intro, in Shorts
 * only. Its reel is a strip of the Chat Highlight card, one cell per message
 * with the pick last, scrolled past a one-cell window on a no-overshoot
 * ease-out, landing on the pick. It fades in over the card's own entrance as
 * it starts. Never on the Live Stream.
 */
export const CHAT_SPIN_MOTION = {
  ms: 1200,
  ease: cubicBezierEase({ x1: 0.16, y1: 1, x2: 0.3, y2: 1 }),
} as const;

/** The spin on one frame: how many cells it has scrolled, and how opaque. */
export type ChatSpinPose = { scroll: number; opacity: number };

/**
 * `ms` into the spin of a strip of `cellCount` cells (the pick included, last):
 * `scroll` runs from 0 (the first cell in the window) to `cellCount - 1` (the
 * pick, landed) and never past it.
 */
export const chatSpinPose = (ms: number, cellCount: number): ChatSpinPose => ({
  scroll:
    Math.max(0, cellCount - 1) *
    CHAT_SPIN_MOTION.ease(ms / CHAT_SPIN_MOTION.ms),
  opacity: CHAT_HIGHLIGHT_MOTION.enter.ease(
    ms / CHAT_HIGHLIGHT_MOTION.enter.ms
  ),
});

/** A Chat Card on one frame: the card's pose, and the spin's scroll. */
export type ChatCardPose = ChatHighlightPose & { scroll: number };

/**
 * A Chat Card's motion, frame by frame: its intro (the spin, or with fewer
 * than two cells the card's own entrance) and its exit (the Chat Highlight's).
 * Every frame between them is the landed card. An Animation Toggle makes its
 * end a hard cut: no frames. A card too short for both keeps its exit whole
 * and cuts its intro short.
 */
export const chatCardMotion = (p: {
  /** The strip's cells, the pick included. */
  cellCount: number;
  fps: number;
  durationInFrames: number;
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
}): { enter: ChatCardPose[]; exit: ChatCardPose[] } => {
  const landed = Math.max(0, p.cellCount - 1);
  const frames = (ms: number) => Math.ceil((ms * p.fps) / 1000);
  const at = (frame: number) => (frame * 1000) / p.fps;
  const spins = p.cellCount >= 2;

  const exit = p.disableExitAnimation
    ? []
    : Array.from({ length: frames(CHAT_HIGHLIGHT_MOTION.exit.ms) }, (_, i) => ({
        ...exitingPose(at(i + 1), { opacity: 1, offsetY: 0 }),
        scroll: landed,
      })).slice(0, p.durationInFrames);
  const enter = p.disableEnterAnimation
    ? []
    : Array.from(
        {
          length: frames(
            spins ? CHAT_SPIN_MOTION.ms : CHAT_HIGHLIGHT_MOTION.enter.ms
          ),
        },
        (_, i) =>
          spins
            ? { ...chatSpinPose(at(i), p.cellCount), offsetY: 0 }
            : { ...enteringPose(at(i)), scroll: 0 }
      ).slice(0, Math.max(0, p.durationInFrames - exit.length));
  return { enter, exit };
};
