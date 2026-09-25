import { describe, expect, it } from "vitest";
import {
  ANIMATIC_FPS,
  CLIP_MOCKUP_GAP_SECONDS,
  UNVOICED_HOLD_SECONDS,
  buildAnimaticTimeline,
  formatRunTime,
  segmentIndexAtFrame,
  type AnimaticClipMockup,
} from "./animatic-timeline";
import { AUTO_EDITED_END_PADDING_SECONDS } from "@/silence-detection-constants";

/**
 * The clock the whole player runs on: the run time the page prints, the frame
 * the scrub bar lands on and the frame "jump to number 14" seeks to are all
 * these numbers. It is pure arithmetic over rows, so it is tested straight —
 * no Remotion, no jsdom, exactly as `clip-mockup-dnd.test.ts` tests the drag
 * arithmetic.
 */

const mockup = (
  position: number,
  durationSeconds: number | null,
  overrides: Partial<AnimaticClipMockup> = {}
): AnimaticClipMockup => ({
  id: `cm_${position}`,
  line: `Line ${position}.`,
  position,
  durationSeconds,
  imageUrl: `/api/clip-mockups/cm_${position}/image`,
  audioUrl: `/api/clip-mockups/cm_${position}/audio`,
  imageMissing: false,
  audioMissing: false,
  ...overrides,
});

const GAP_FRAMES = Math.round(CLIP_MOCKUP_GAP_SECONDS * ANIMATIC_FPS);

describe("the Animatic's gap", () => {
  it("is the same padding the Clip cutter leaves at the end of a Clip", () => {
    expect(CLIP_MOCKUP_GAP_SECONDS).toBe(AUTO_EDITED_END_PADDING_SECONDS);
  });
});

describe("buildAnimaticTimeline", () => {
  it("lays Clip Mockups end to end, each holding for its own line", () => {
    const timeline = buildAnimaticTimeline([mockup(1, 2), mockup(2, 3)]);

    expect(timeline.segments.map((s) => s.startFrame)).toEqual([
      0,
      Math.round(2 * ANIMATIC_FPS) + GAP_FRAMES,
    ]);
    expect(timeline.segments.map((s) => s.speechInFrames)).toEqual([
      Math.round(2 * ANIMATIC_FPS),
      Math.round(3 * ANIMATIC_FPS),
    ]);
  });

  it("puts the gap after every Clip Mockup, including the last", () => {
    const timeline = buildAnimaticTimeline([mockup(1, 2)]);

    expect(timeline.segments[0]!.durationInFrames).toBe(
      timeline.segments[0]!.speechInFrames + GAP_FRAMES
    );
    expect(timeline.durationInFrames).toBe(
      timeline.segments[0]!.durationInFrames
    );
  });

  it("starts each segment at the exact sum of the ones before it, so a seek never drifts", () => {
    const timeline = buildAnimaticTimeline([
      mockup(1, 1.37),
      mockup(2, 4.02),
      mockup(3, 0.51),
    ]);

    let running = 0;
    for (const segment of timeline.segments) {
      expect(segment.startFrame).toBe(running);
      running += segment.durationInFrames;
    }
    expect(timeline.durationInFrames).toBe(running);
  });

  it("sums the run time off the unrounded floats", () => {
    const timeline = buildAnimaticTimeline([mockup(1, 1.37), mockup(2, 4.02)]);

    expect(timeline.totalSeconds).toBeCloseTo(
      1.37 + 4.02 + 2 * CLIP_MOCKUP_GAP_SECONDS,
      10
    );
  });

  it("holds an unvoiced Clip Mockup instead of flashing it past in one frame", () => {
    const timeline = buildAnimaticTimeline([mockup(1, null)]);

    expect(timeline.segments[0]!.speechInFrames).toBe(
      Math.round(UNVOICED_HOLD_SECONDS * ANIMATIC_FPS)
    );
  });

  it("never gives a segment zero frames", () => {
    const timeline = buildAnimaticTimeline([mockup(1, 0)]);

    expect(timeline.segments[0]!.speechInFrames).toBe(1);
  });

  it("never reports zero frames overall — Remotion refuses that", () => {
    expect(buildAnimaticTimeline([]).durationInFrames).toBe(1);
    expect(buildAnimaticTimeline([]).totalSeconds).toBe(0);
  });
});

describe("segmentIndexAtFrame", () => {
  const segments = buildAnimaticTimeline([
    mockup(1, 2),
    mockup(2, 2),
    mockup(3, 2),
  ]).segments;

  it("reports the segment the playhead sits in", () => {
    expect(segmentIndexAtFrame(segments, 0)).toBe(0);
    expect(segmentIndexAtFrame(segments, segments[1]!.startFrame)).toBe(1);
    expect(segmentIndexAtFrame(segments, segments[2]!.startFrame + 5)).toBe(2);
  });

  it("counts the gap after a Clip Mockup as still being on it", () => {
    const lastFrameOfFirst = segments[1]!.startFrame - 1;
    expect(segmentIndexAtFrame(segments, lastFrameOfFirst)).toBe(0);
  });

  it("is -1 only for an empty timeline", () => {
    expect(segmentIndexAtFrame([], 0)).toBe(-1);
  });
});

describe("formatRunTime", () => {
  it("reads as minutes and seconds", () => {
    expect(formatRunTime(0)).toBe("0:00");
    expect(formatRunTime(7)).toBe("0:07");
    expect(formatRunTime(247)).toBe("4:07");
  });

  it("grows an hours field once an Animatic passes the hour", () => {
    expect(formatRunTime(3847)).toBe("1:04:07");
  });
});
