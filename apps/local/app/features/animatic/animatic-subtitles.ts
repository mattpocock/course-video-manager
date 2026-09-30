import { useCallback, useMemo } from "react";
import {
  useLocalStorage,
  useLocalStorageOneOf,
} from "@/hooks/use-local-storage";
import {
  MAXIMUM_SUBTITLE_LENGTH_IN_CHARS,
  splitSubtitleSegments,
} from "@/lib/subtitle-chunks";
import { ANIMATIC_FPS, type AnimaticSegment } from "./animatic-timeline";

/**
 * The Animatic's subtitles: each Clip Mockup's line, shown over its frame a
 * short phrase at a time while it is spoken.
 *
 * HOW MUCH TEXT IS ON SCREEN AT ONCE is the Shorts renderer's rule, imported
 * from `subtitle-chunks.ts` rather than copied — the words shared out evenly,
 * the time shared out evenly. The line has no per-word timing, so even division
 * is also the only honest option here. The limit is DOUBLE the Short's: a
 * landscape frame is wide, and 32 characters cut the line too choppily.
 *
 * ON BY DEFAULT, because the author judges the density of a moment by reading
 * it as well as hearing it, often at two times speed. The choice to turn them
 * off is remembered in the browser, like the playback rate.
 */

/** The longest phrase the Animatic shows at once: twice a Short's. */
export const ANIMATIC_SUBTITLE_LENGTH_IN_CHARS =
  MAXIMUM_SUBTITLE_LENGTH_IN_CHARS * 2;

/** One phrase of a Clip Mockup's line, in frames from that Clip Mockup's start. */
export interface AnimaticSubtitleCue {
  readonly fromFrame: number;
  readonly durationInFrames: number;
  readonly text: string;
}

/**
 * Split one Clip Mockup's line into the phrases shown over it. The phrases
 * share out the speech; the last one then holds through the gap after it, so
 * the text does not blink off between two Clip Mockups.
 */
export function subtitleCuesForSegment(
  segment: AnimaticSegment
): AnimaticSubtitleCue[] {
  // A line can hold newlines and runs of spaces; the chunker splits on single
  // spaces, so a stray one would count as a word.
  const text = segment.mockup.line.replace(/\s+/g, " ").trim();
  if (text === "") return [];

  const chunks = splitSubtitleSegments(
    {
      start: 0,
      end: segment.speechInFrames / ANIMATIC_FPS,
      text,
    },
    ANIMATIC_SUBTITLE_LENGTH_IN_CHARS
  ).filter((chunk) => chunk.text !== "");

  return chunks.map((chunk, index) => {
    const fromFrame = Math.round(chunk.start * ANIMATIC_FPS);
    const endFrame =
      index === chunks.length - 1
        ? segment.durationInFrames
        : Math.round(chunk.end * ANIMATIC_FPS);
    return {
      fromFrame,
      durationInFrames: Math.max(1, endFrame - fromFrame),
      text: chunk.text,
    };
  });
}

const STORAGE_KEY = "animatic:subtitles";

const SUBTITLE_SETTINGS = ["on", "off"];

/** Whether the Animatic shows subtitles, remembered in the browser. On by default. */
export function useAnimaticSubtitles(): [boolean, (on: boolean) => void] {
  const [stored, setStored] = useLocalStorageOneOf(
    STORAGE_KEY,
    SUBTITLE_SETTINGS,
    "on"
  );

  const choose = useCallback(
    (on: boolean) => setStored(on ? "on" : "off"),
    [setStored]
  );

  return [stored === "on", choose];
}

/**
 * How the subtitles are drawn: how far up or down from their usual place, how
 * big, and how wide a phrase may run before it wraps. The author moves them off
 * whatever part of a frame he is judging — code at the bottom of a slide, say.
 *
 * In composition pixels (the frame is 1920 wide), so a setting looks the same
 * at every size of the browser window. Remembered in the browser, like the
 * rate and the on/off, because it is a habit of the watcher.
 */
export interface AnimaticSubtitleStyle {
  /** Pixels UP from the usual place. Negative moves them down. */
  readonly offsetY: number;
  readonly fontSize: number;
  /** The widest a phrase runs, in `ch` of its own font, before it wraps. */
  readonly maxWidthCh: number;
}

/** Each setting's range, as its slider offers it. */
export const ANIMATIC_SUBTITLE_STYLE_RANGES = {
  offsetY: { min: -200, max: 200, step: 5 },
  fontSize: { min: 24, max: 96, step: 2 },
  maxWidthCh: { min: 20, max: 120, step: 1 },
} as const satisfies Record<
  keyof AnimaticSubtitleStyle,
  { min: number; max: number; step: number }
>;

/** What the subtitles looked like before they could be changed. */
export const DEFAULT_ANIMATIC_SUBTITLE_STYLE: AnimaticSubtitleStyle = {
  offsetY: 0,
  fontSize: 52,
  maxWidthCh: 60,
};

/**
 * The style a stored string stands for. Each setting is read on its own and
 * held inside its range, so a hand-edited or half-written value loses only the
 * setting that is wrong, never the others.
 */
export function parseAnimaticSubtitleStyle(raw: string): AnimaticSubtitleStyle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_ANIMATIC_SUBTITLE_STYLE;
  }
  const stored =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};

  const read = (key: keyof AnimaticSubtitleStyle): number => {
    const value = stored[key];
    const { min, max } = ANIMATIC_SUBTITLE_STYLE_RANGES[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_ANIMATIC_SUBTITLE_STYLE[key];
    }
    return Math.min(max, Math.max(min, value));
  };

  return {
    offsetY: read("offsetY"),
    fontSize: read("fontSize"),
    maxWidthCh: read("maxWidthCh"),
  };
}

const STYLE_STORAGE_KEY = "animatic:subtitleStyle";

/** The subtitle style, remembered in the browser. */
export function useAnimaticSubtitleStyle(): [
  AnimaticSubtitleStyle,
  (next: AnimaticSubtitleStyle) => void,
] {
  const [raw, setRaw] = useLocalStorage(
    STYLE_STORAGE_KEY,
    JSON.stringify(DEFAULT_ANIMATIC_SUBTITLE_STYLE)
  );

  const style = useMemo(() => parseAnimaticSubtitleStyle(raw), [raw]);

  const choose = useCallback(
    (next: AnimaticSubtitleStyle) => setRaw(JSON.stringify(next)),
    [setRaw]
  );

  return [style, choose];
}
