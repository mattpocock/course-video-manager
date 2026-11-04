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
 * A SHORT'S CHAT CARD'S MOTION (#2669): very subtle, as Matt asked ("by nice
 * animation I mean very subtle one"). It fades in over 200 ms while rising
 * 10 px on a strong ease-out, and fades out over 150 ms on an ease-out
 * without moving. No bounce, no overshoot, no spin: both curves stay inside
 * 0..1. Its own constants, apart from the Live Stream's, so retuning one
 * never moves the other.
 */
export const CHAT_CARD_MOTION = {
  enter: {
    ms: 200,
    /** It starts this many Short pixels below its place. */
    risePx: 10,
    ease: cubicBezierEase({ x1: 0.23, y1: 1, x2: 0.32, y2: 1 }),
  },
  exit: {
    ms: 150,
    ease: cubicBezierEase({ x1: 0, y1: 0, x2: 0.58, y2: 1 }),
  },
} as const;

/** The most a Chat Card is ever below its place: the room its box needs. */
export const CHAT_CARD_TRAVEL_PX = CHAT_CARD_MOTION.enter.risePx;

/**
 * A Chat Card's motion, frame by frame: its entrance and its exit. Every
 * frame between them is the settled card. An Animation Toggle makes its end
 * a hard cut: no frames. A card too short for both keeps its exit whole and
 * cuts its entrance short.
 */
export const chatCardMotion = (p: {
  fps: number;
  durationInFrames: number;
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
}): { enter: ChatHighlightPose[]; exit: ChatHighlightPose[] } => {
  const { enter: inn, exit: out } = CHAT_CARD_MOTION;
  const frames = (ms: number) => Math.ceil((ms * p.fps) / 1000);
  const at = (frame: number) => (frame * 1000) / p.fps;

  const exit = p.disableExitAnimation
    ? []
    : Array.from({ length: frames(out.ms) }, (_, i) => ({
        opacity: 1 - out.ease(at(i + 1) / out.ms),
        offsetY: 0,
      })).slice(0, p.durationInFrames);
  const enter = p.disableEnterAnimation
    ? []
    : Array.from({ length: frames(inn.ms) }, (_, i) => {
        const e = inn.ease(at(i) / inn.ms);
        return { opacity: e, offsetY: inn.risePx * (1 - e) };
      }).slice(0, Math.max(0, p.durationInFrames - exit.length));
  return { enter, exit };
};
