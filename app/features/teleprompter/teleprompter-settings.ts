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
  fontWeight: 500,
  lineHeight: 1.55,
  letterSpacing: 0,
  /** Measure in `ch`. Short lines are the biggest teleprompter lever there is. */
  measure: 25,
  /** Warm rather than white: easier on the eye through beam-splitter glass. */
  color: "#f5e9d7",
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
    textAlign: "center",
  };
}

/** Which document is on the glass. */
export const SOURCES = ["beats", "script"] as const;
export type Source = (typeof SOURCES)[number];

export const MIN_WPM = 80;
export const MAX_WPM = 400;
const DEFAULT_WPM = 200;

export type TeleprompterSettings = {
  source: Source;
  /** Crawl speed, in spoken words per minute. */
  wpm: number;
};

export function useTeleprompterSettings(): [
  TeleprompterSettings,
  <K extends keyof TeleprompterSettings>(
    key: K,
    value: TeleprompterSettings[K]
  ) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawSource = searchParams.get("source");
  const rawWpm = Number(searchParams.get("wpm"));

  const settings: TeleprompterSettings = {
    source: (SOURCES as readonly string[]).includes(rawSource ?? "")
      ? (rawSource as Source)
      : "script",
    wpm:
      Number.isFinite(rawWpm) && rawWpm > 0
        ? Math.min(MAX_WPM, Math.max(MIN_WPM, rawWpm))
        : DEFAULT_WPM,
  };

  const update = useCallback(
    <K extends keyof TeleprompterSettings>(
      key: K,
      value: TeleprompterSettings[K]
    ) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(key, String(value));
          return next;
        },
        { replace: true, preventScrollReset: true }
      );
    },
    [setSearchParams]
  );

  return [settings, update];
}
