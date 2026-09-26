import { describe, expect, it } from "vitest";
import { MAXIMUM_SUBTITLE_LENGTH_IN_CHARS } from "@/lib/subtitle-chunks";
import { subtitleCuesForSegment } from "./animatic-subtitles";
import {
  ANIMATIC_FPS,
  buildAnimaticTimeline,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * The Animatic's subtitles are pure arithmetic over one segment: the phrases
 * the Shorts renderer would cut the line into, laid over its speech.
 */

const segmentFor = (line: string, durationSeconds: number) =>
  buildAnimaticTimeline([
    {
      id: "cm_1",
      line,
      position: 1,
      durationSeconds,
      order: "a1",
      imageUrl: "/api/clip-mockups/cm_1/image",
      audioUrl: "/api/clip-mockups/cm_1/audio",
      imageMissing: false,
      audioMissing: false,
    } satisfies AnimaticClipMockup,
  ]).segments[0]!;

describe("subtitleCuesForSegment", () => {
  it("shows a short line whole, from the first frame to the end of the gap", () => {
    const segment = segmentFor("Hello there.", 2);

    expect(subtitleCuesForSegment(segment)).toEqual([
      {
        fromFrame: 0,
        durationInFrames: segment.durationInFrames,
        text: "Hello there.",
      },
    ]);
  });

  it("never shows more than the Shorts renderer's limit at once, give or take a word", () => {
    const line =
      "Generics let you write a function once and have it work across many different types without losing safety.";
    const cues = subtitleCuesForSegment(segmentFor(line, 6));

    expect(cues.length).toBe(
      Math.ceil(line.length / MAXIMUM_SUBTITLE_LENGTH_IN_CHARS)
    );
    expect(cues.map((c) => c.text).join(" ")).toBe(line);
  });

  it("shares the speech out evenly, back to back, and holds the last phrase through the gap", () => {
    const segment = segmentFor(
      "one two three four five six seven eight nine ten eleven twelve thirteen",
      3
    );
    const cues = subtitleCuesForSegment(segment);

    expect(cues[0]!.fromFrame).toBe(0);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.fromFrame).toBe(
        cues[i - 1]!.fromFrame + cues[i - 1]!.durationInFrames
      );
    }
    const last = cues.at(-1)!;
    expect(last.fromFrame + last.durationInFrames).toBe(
      segment.durationInFrames
    );
    expect(cues[1]!.fromFrame).toBe(
      Math.round((3 * ANIMATIC_FPS) / cues.length)
    );
  });

  it("treats newlines and runs of spaces as single spaces", () => {
    const cues = subtitleCuesForSegment(
      segmentFor("Line one.\n\nLine   two.", 2)
    );

    expect(cues.map((c) => c.text)).toEqual(["Line one. Line two."]);
  });

  it("shows nothing for an empty line", () => {
    expect(subtitleCuesForSegment(segmentFor("  \n ", 2))).toEqual([]);
  });
});
