/**
 * PROTOTYPE — throwaway.
 *
 * Every knob lives in the URL, so a setup that feels right is a link you can
 * paste back and a reload mid-take doesn't lose it. Deliberately over-supplied:
 * the point is that you can tune the type yourself rather than describing what
 * you want and waiting for a rebuild.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router";

export const VARIANTS = ["A", "B", "C"] as const;
export type Variant = (typeof VARIANTS)[number];

export const VARIANT_NAMES: Record<Variant, string> = {
  A: "Crawl — continuous scroll",
  B: "Stepper — one chunk at a time",
  C: "Band — manual nudge, spotlit line",
};

/** Which document is on the glass. A visible tab, not just a param. */
export const SOURCES = ["beats", "script"] as const;
export type Source = (typeof SOURCES)[number];

export const FONT_FAMILIES = {
  system:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  humanist: '"Optima", "Gill Sans", "Trebuchet MS", sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  slab: '"Rockwell", "Roboto Slab", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;
export type FontFamilyKey = keyof typeof FONT_FAMILIES;
export const FONT_FAMILY_KEYS = Object.keys(FONT_FAMILIES) as FontFamilyKey[];

/** Warmer / dimmer text is easier on the eye through beam-splitter glass. */
export const TEXT_COLORS = {
  white: "#ffffff",
  warm: "#f5e9d7",
  amber: "#ffcc66",
  phosphor: "#9dffb0",
  grey: "#cbd5e1",
} as const;
export type TextColorKey = keyof typeof TEXT_COLORS;
export const TEXT_COLOR_KEYS = Object.keys(TEXT_COLORS) as TextColorKey[];

export type PrototypeSettings = {
  source: Source;
  variant: Variant;
  /** Where the live text is pinned, % of viewport. */
  readLine: number;
  fontSize: number;
  fontFamily: FontFamilyKey;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  /** Measure, in `ch`. Short lines are the biggest teleprompter lever there is. */
  measure: number;
  textColor: TextColorKey;
  align: "left" | "center";
  /** Crawl speed for variant A, and auto-advance dwell for B. */
  wpm: number;
  /** Beam-splitter glass may need horizontally mirrored text. */
  mirror: boolean;
};

const DEFAULTS: PrototypeSettings = {
  source: "beats",
  variant: "A",
  readLine: 42,
  fontSize: 44,
  fontFamily: "system",
  fontWeight: 500,
  lineHeight: 1.5,
  letterSpacing: 0,
  measure: 34,
  textColor: "warm",
  align: "center",
  wpm: 130,
  mirror: false,
};

function num(raw: string | null, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function oneOf<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/** Typography shared by every variant. Layout is emphatically not shared. */
export function textStyle(settings: PrototypeSettings): React.CSSProperties {
  return {
    fontFamily: FONT_FAMILIES[settings.fontFamily],
    fontSize: `${settings.fontSize}px`,
    fontWeight: settings.fontWeight,
    lineHeight: settings.lineHeight,
    letterSpacing: `${settings.letterSpacing}em`,
    color: TEXT_COLORS[settings.textColor],
    textAlign: settings.align,
  };
}

export function useTeleprompterSettings(): [
  PrototypeSettings,
  <K extends keyof PrototypeSettings>(
    key: K,
    value: PrototypeSettings[K]
  ) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();

  const settings: PrototypeSettings = {
    source: oneOf(searchParams.get("source"), SOURCES, DEFAULTS.source),
    variant: oneOf(searchParams.get("variant"), VARIANTS, DEFAULTS.variant),
    readLine: num(searchParams.get("readLine"), DEFAULTS.readLine),
    fontSize: num(searchParams.get("fontSize"), DEFAULTS.fontSize),
    fontFamily: oneOf(
      searchParams.get("fontFamily"),
      FONT_FAMILY_KEYS,
      DEFAULTS.fontFamily
    ),
    fontWeight: num(searchParams.get("fontWeight"), DEFAULTS.fontWeight),
    lineHeight: num(searchParams.get("lineHeight"), DEFAULTS.lineHeight),
    letterSpacing: num(
      searchParams.get("letterSpacing"),
      DEFAULTS.letterSpacing
    ),
    measure: num(searchParams.get("measure"), DEFAULTS.measure),
    textColor: oneOf(
      searchParams.get("textColor"),
      TEXT_COLOR_KEYS,
      DEFAULTS.textColor
    ),
    align: oneOf(searchParams.get("align"), ["left", "center"], DEFAULTS.align),
    wpm: num(searchParams.get("wpm"), DEFAULTS.wpm),
    mirror: searchParams.get("mirror") === "1",
  };

  const update = useCallback(
    <K extends keyof PrototypeSettings>(
      key: K,
      value: PrototypeSettings[K]
    ) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(
            key,
            typeof value === "boolean" ? (value ? "1" : "0") : String(value)
          );
          return next;
        },
        { replace: true, preventScrollReset: true }
      );
    },
    [setSearchParams]
  );

  return [settings, update];
}
