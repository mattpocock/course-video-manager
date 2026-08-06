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
   * The Beats column, in `ch` of the page's own type rather than the glass's —
   * the column sets no font of its own, so this number isn't comparable to
   * `measure` above, only to itself.
   *
   * A short measure is for reading a line aloud without losing your place in
   * it. The plan isn't read that way: it's glanced at, a row at a time, behind
   * an icon gutter that takes width off every line. Wide enough that a beat's
   * sentence lands in a line or two rather than a stack of fragments.
   *
   * Anchored to the page's type, so it doesn't follow `beatTitleScale`: setting
   * the plan a step larger buys no extra width, it spends some. Tune the two
   * together, and judge the result by characters on a line rather than by
   * either number on its own.
   */
  beatsMeasure: 36,
  /**
   * A Beat Title, against the script's body size. The rest of the row — the
   * icon gutter, and the description under it — is sized from the title, so
   * this is the one number that scales a beat.
   *
   * The script's size is tuned for reading a line off the glass word by word,
   * from where the lens has you standing. A beat is taken in whole and at a
   * glance — often from further back than that, and never mid-sentence — so it
   * is set a step above. A step, not a jump: much larger and a plan of a dozen
   * beats stops fitting on the glass at once, which is the thing the Beats view
   * is for.
   */
  beatTitleScale: 1.1,
  /**
   * A Beat Description, relative to the beat title above it.
   *
   * The title is what you scan the plan for; the description is the detail you
   * read once you've found it. Set at the same size the two run together into
   * one wall of text and the plan loses its shape at a glance. Well above the
   * cue size, though — a description is a sentence of what you're about to
   * actually do, and it still has to be legible from where you stand.
   */
  beatDescriptionScale: 0.7,
  /**
   * Warm rather than white: easier on the eye through beam-splitter glass.
   *
   * Colours here are Tailwind palette variables rather than hexes — Tailwind v4
   * publishes the whole scale as CSS custom properties, so inline styles can
   * name the same colours the classNames do.
   */
  color: "var(--color-orange-100)",
  /**
   * What the script marks bold. Cool against the warm body, so emphasis is
   * visible in peripheral vision before you reach the words — weight alone only
   * registers once you're looking straight at it.
   */
  boldColor: "var(--color-sky-300)",
  /**
   * Cues are stage directions, not lines — read at a glance and never aloud.
   * Small enough that the eye registers "not my words" before it reads them,
   * and still large enough to take in without leaning towards the glass.
   *
   * Relative to whatever the cue sits in, not to the body size: a cue inside a
   * heading is already set smaller than the body, and an aside that came out
   * larger than the line it interrupts would do the opposite of its job.
   */
  cueScale: 0.6,
  /**
   * Grey, and deliberately the coolest, quietest thing on the glass: cues sit
   * inside sentences the reader is speaking, so they have to fall away in
   * peripheral vision rather than compete with the line being delivered.
   */
  cueColor: "var(--color-neutral-400)",
  /**
   * The same cool as bold, because a link is emphasis of a kind — the underline
   * is what says "this one is clickable", and it's the only underline on the
   * glass, so it doesn't have to shout.
   */
  linkColor: "var(--color-sky-300)",
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
    // Left, so the eye returns to the same x on every line. Justifying fixes
    // the right edge too, but on a measure this narrow it buys that by
    // stretching word-spaces, and the rivers that opens are worse to read past
    // than a ragged edge you never look at.
    textAlign: "left",
    // A URL or a file path is one unbreakable "word" far wider than the
    // measure, and left to itself it runs off the right of the glass — off the
    // panel entirely, since the crawl clips rather than scrolls sideways.
    // Breaking mid-word is ugly and keeps every character on the glass; losing
    // the end of the line is neither.
    overflowWrap: "anywhere",
    // The window as a whole is inert to the pointer — `select-none` on the
    // teleprompter shell in `app/routes/teleprompter.tsx`, because the glass
    // lives reflected in front of a lens and a stray drag highlighting the
    // chrome is pure noise. The words themselves are the exception: a line of
    // script or a beat's note is as often something to paste elsewhere as
    // something to read aloud, so everything set in this type opts back in.
    // Inline, so it beats that class wherever this style lands.
    userSelect: "text",
  };
}

/**
 * How a link looks on the glass. Underlined rather than merely coloured: the
 * teleprompter is watched from arm's length through beam-splitter glass, where
 * a hue shift alone doesn't read as "you can click this".
 */
export function linkStyle(): React.CSSProperties {
  return {
    color: TYPE.linkColor,
    textDecoration: "underline",
    // The body weight is light, so a default-thickness rule sits heavier than
    // the letters it belongs to.
    textDecorationThickness: "1px",
    textUnderlineOffset: "0.18em",
  };
}

/**
 * How a cue looks, wherever it appears — a block of its own, or mid-sentence.
 * One definition so the two never drift apart on the glass.
 */
export function cueStyle(): React.CSSProperties {
  return {
    fontSize: `${TYPE.cueScale}em`,
    fontStyle: "italic",
    color: TYPE.cueColor,
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
 * Speed is the only setting that persists. Which document is on the glass
 * follows the editor's side panel — see `teleprompterSession.resolveSource` —
 * so there's nothing to remember.
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
