import { useCallback } from "react";
import { useLocalStorageOneOf } from "@/hooks/use-local-storage";
import { splitSubtitleSegments } from "@/lib/subtitle-chunks";
import { ANIMATIC_FPS, type AnimaticSegment } from "./animatic-timeline";

/**
 * The Animatic's subtitles: each Clip Mockup's line, shown over its frame a
 * short phrase at a time while it is spoken.
 *
 * HOW MUCH TEXT IS ON SCREEN AT ONCE is the Shorts renderer's rule, imported
 * from `subtitle-chunks.ts` rather than copied — the same 32 characters, the
 * words shared out evenly, the time shared out evenly. The line has no
 * per-word timing, so even division is also the only honest option here.
 *
 * ON BY DEFAULT, because the author judges the density of a moment by reading
 * it as well as hearing it, often at two times speed. The choice to turn them
 * off is remembered in the browser, like the playback rate.
 */

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

  const chunks = splitSubtitleSegments({
    start: 0,
    end: segment.speechInFrames / ANIMATIC_FPS,
    text,
  }).filter((chunk) => chunk.text !== "");

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
