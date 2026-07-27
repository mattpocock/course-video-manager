/**
 * How the teleprompter looks, and the two things that stay adjustable.
 *
 * The type is fixed. It was tuned against the real Prompter panel and settled;
 * a teleprompter that looks different every take is worse than one that looks
 * merely good, so these are constants, not controls. Change them here.
 *
 * What stays adjustable is what genuinely varies per take: which document is on
 * the glass, and how fast it rolls. Both live in the URL so a reload mid-session
 * doesn't lose them.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router";

export const TYPE = {
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 26,
  /**
   * Light. Through beam-splitter glass a heavy face blooms and the counters
   * fill in; bold is reserved for the words the script actually marks bold.
   * 300 is as far down as the system stack goes with a real cut — below that
   * the browser synthesises, which thins the strokes unevenly.
   */
  fontWeight: 300,
  /**
   * Generous. Light justified type on a narrow measure needs the horizontal
   * white between words to be clearly outweighed by the white between lines,
   * or the eye starts reading down the gaps instead of across the line.
   */
  lineHeight: 1.65,
  letterSpacing: 0,
  /** Measure in `ch`. Short lines are the biggest teleprompter lever there is. */
  measure: 25,
  /**
   * Beats run wider than the script. They're left-aligned behind an icon
   * gutter, so the script's measure leaves them narrower than it looks — and
   * they're glanced at rather than read aloud, which is what the short measure
   * is for.
   */
  beatsMeasure: 30,
  /** Warm rather than white: easier on the eye through beam-splitter glass. */
  color: "#f5e9d7",
  /**
   * What the script marks bold. Cool against the warm body, so emphasis is
   * visible in peripheral vision before you reach the words — weight alone only
   * registers once you're looking straight at it.
   */
  boldColor: "#a8d5ff",
  /** Where the live line sits, as a % of viewport height. */
  readLine: 42,
} as const;

export function textStyle(): React.CSSProperties {
  return {
    fontFamily: TYPE.fontFamily,
    fontSize: `${TYPE.fontSize}px`,
    fontWeight: TYPE.fontWeight,
    lineHeight: TYPE.lineHeight,
    letterSpacing: `${TYPE.letterSpacing}em`,
    color: TYPE.color,
    // Justified, so both edges of the column are fixed and the eye returns to
    // the same x on every line instead of hunting for a ragged start.
    textAlign: "justify",
  };
}

/** Which document is on the glass. */
export const SOURCES = ["beats", "script"] as const;
export type Source = (typeof SOURCES)[number];

export const MIN_WPM = 80;
export const MAX_WPM = 400;
const DEFAULT_WPM = 200;

/**
 * Crawl speed, in spoken words per minute, kept in the URL so a reload
 * mid-session doesn't lose it.
 *
 * Speed is the only setting that persists. Which document is on the glass is
 * derived from the video — see `teleprompterSession.resolveSource` — because a
 * remembered tab is wrong the moment you move to a video shaped differently.
 */
export function useTeleprompterWpm(): [number, (wpm: number) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = Number(searchParams.get("wpm"));
  const wpm =
    Number.isFinite(raw) && raw > 0
      ? Math.min(MAX_WPM, Math.max(MIN_WPM, raw))
      : DEFAULT_WPM;

  const setWpm = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_WPM, Math.max(MIN_WPM, next));
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("wpm", String(clamped));
          return params;
        },
        { replace: true, preventScrollReset: true }
      );
    },
    [setSearchParams]
  );

  return [wpm, setWpm];
}
