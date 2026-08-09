import { describe, it, expect } from "vitest";
import {
  computeClipVideoOffsets,
  absoluteSilencePeriodsWithinClip,
  excludeLongPeriods,
  spansFromPeriods,
  computeJoinWindow,
  findJoinHits,
  sanitizeProofreadOptions,
  classifyPerClipSpans,
  classifyBoundarySpan,
  DEFAULT_PROOFREAD_OPTIONS,
} from "./clip-audio-proofread";

describe("computeClipVideoOffsets", () => {
  it("returns cumulative offsets, ignoring source gaps between clips", () => {
    const clips = [
      {
        id: "a",
        videoFilename: "f.mkv",
        sourceStartTime: 10,
        sourceEndTime: 15,
      }, // 5s
      {
        id: "b",
        videoFilename: "f.mkv",
        sourceStartTime: 50,
        sourceEndTime: 53,
      }, // 3s
      { id: "c", videoFilename: "g.mkv", sourceStartTime: 0, sourceEndTime: 2 }, // 2s
    ];

    const offsets = computeClipVideoOffsets(clips);

    expect(offsets).toEqual([
      { clipId: "a", videoStartSeconds: 0, durationSeconds: 5 },
      { clipId: "b", videoStartSeconds: 5, durationSeconds: 3 },
      { clipId: "c", videoStartSeconds: 8, durationSeconds: 2 },
    ]);
  });

  it("returns an empty list for no clips", () => {
    expect(computeClipVideoOffsets([])).toEqual([]);
  });
});

describe("absoluteSilencePeriodsWithinClip", () => {
  const clip = { sourceStartTime: 100, sourceEndTime: 110 };

  it("shifts seek-relative periods into the source file's absolute timeline", () => {
    // Seeked to 100, so a period reported at 2..4 is really 102..104 in the file.
    const raw = [
      "[silencedetect @ 0x1] silence_start: 2",
      "[silencedetect @ 0x1] silence_end: 4 | silence_duration: 2",
    ].join("\n");

    const periods = absoluteSilencePeriodsWithinClip(raw, clip);

    expect(periods).toEqual([{ start: 102, end: 104 }]);
  });

  it("clamps a period that runs past the clip's own end", () => {
    // Clip ends at 110 (absolute); this period starts inside the clip (at
    // absolute 108) but silencedetect keeps running past it to 115.
    const raw = [
      "[silencedetect @ 0x1] silence_start: 8",
      "[silencedetect @ 0x1] silence_end: 15 | silence_duration: 7",
    ].join("\n");

    const periods = absoluteSilencePeriodsWithinClip(raw, clip);

    expect(periods).toEqual([{ start: 108, end: 110 }]);
  });

  it("drops a period that starts at or after the clip's own end", () => {
    // Belongs to whatever comes after this clip in the source file.
    const raw = [
      "[silencedetect @ 0x1] silence_start: 12",
      "[silencedetect @ 0x1] silence_end: 14 | silence_duration: 2",
    ].join("\n");

    expect(absoluteSilencePeriodsWithinClip(raw, clip)).toEqual([]);
  });

  it("returns an empty list when ffmpeg reports no silence", () => {
    expect(absoluteSilencePeriodsWithinClip("", clip)).toEqual([]);
  });
});

describe("excludeLongPeriods", () => {
  it("filters out periods at or above the long-pause floor", () => {
    const periods = [
      { start: 0, end: 0.5 }, // 0.5s
      { start: 10, end: 12.5 }, // 2.5s
      { start: 20, end: 22 }, // 2.0s — exactly at the floor
    ];

    expect(excludeLongPeriods(periods, 2.0)).toEqual([{ start: 0, end: 0.5 }]);
  });

  it("keeps everything when nothing meets the floor", () => {
    const periods = [{ start: 0, end: 0.2 }];
    expect(excludeLongPeriods(periods, 2.0)).toEqual(periods);
  });
});

describe("spansFromPeriods", () => {
  const clip = { id: "clip-1", sourceStartTime: 100 };

  it("maps clip-relative offset and video-relative timestamp together", () => {
    const periods = [{ start: 102, end: 104.5 }];

    const spans = spansFromPeriods(periods, clip, 50, "long-pause");

    expect(spans).toEqual([
      {
        type: "long-pause",
        videoTimestampSeconds: 52,
        clipId: "clip-1",
        clipRelativeOffsetSeconds: 2,
        durationSeconds: 2.5,
      },
    ]);
  });

  it("maps multiple periods to multiple spans in order", () => {
    const periods = [
      { start: 100.1, end: 100.3 },
      { start: 105, end: 105.2 },
    ];

    const spans = spansFromPeriods(periods, clip, 0, "short-cutout");

    expect(spans.map((s) => s.clipRelativeOffsetSeconds)).toEqual([0.1, 5]);
    expect(spans.every((s) => s.type === "short-cutout")).toBe(true);
  });
});

describe("computeJoinWindow", () => {
  it("takes the last windowSeconds of clip A and the first windowSeconds of clip B", () => {
    const clipA = {
      videoFilename: "a.mkv",
      sourceStartTime: 0,
      sourceEndTime: 30,
    };
    const clipB = {
      videoFilename: "b.mkv",
      sourceStartTime: 5,
      sourceEndTime: 40,
    };

    const { segmentA, segmentB, joinPointSeconds } = computeJoinWindow(
      clipA,
      clipB,
      1
    );

    expect(segmentA).toEqual({
      file: "a.mkv",
      seekSeconds: 29,
      durationSeconds: 1,
    });
    expect(segmentB).toEqual({
      file: "b.mkv",
      seekSeconds: 5,
      durationSeconds: 1,
    });
    expect(joinPointSeconds).toBe(1);
  });

  it("clamps the window to a clip shorter than the requested window", () => {
    // Clip A is only 0.4s long in total, clip B only 0.3s.
    const clipA = {
      videoFilename: "a.mkv",
      sourceStartTime: 10,
      sourceEndTime: 10.4,
    };
    const clipB = {
      videoFilename: "b.mkv",
      sourceStartTime: 0,
      sourceEndTime: 0.3,
    };

    const { segmentA, segmentB, joinPointSeconds } = computeJoinWindow(
      clipA,
      clipB,
      1
    );

    expect(segmentA.file).toBe("a.mkv");
    expect(segmentA.seekSeconds).toBe(10);
    expect(segmentA.durationSeconds).toBeCloseTo(0.4);
    expect(segmentB).toEqual({
      file: "b.mkv",
      seekSeconds: 0,
      durationSeconds: 0.3,
    });
    expect(joinPointSeconds).toBeCloseTo(0.4);
  });
});

describe("findJoinHits", () => {
  it("keeps a period that straddles the join point", () => {
    const periods = [{ start: 0.8, end: 1.2 }];
    expect(findJoinHits(periods, 1, 0.2)).toEqual(periods);
  });

  it("keeps a period within tolerance of, but not touching, the join point", () => {
    const periods = [{ start: 1.15, end: 1.3 }];
    expect(findJoinHits(periods, 1, 0.2)).toEqual(periods);
  });

  it("drops a period entirely inside one clip's own trimmed second, away from the join", () => {
    const periods = [{ start: 0.1, end: 0.3 }];
    expect(findJoinHits(periods, 1, 0.2)).toEqual([]);
  });

  it("a tighter tolerance drops a hit a looser one would keep — proves the knob changes behavior", () => {
    const periods = [{ start: 1.15, end: 1.3 }];
    expect(findJoinHits(periods, 1, 0.2)).toEqual(periods);
    expect(findJoinHits(periods, 1, 0.05)).toEqual([]);
  });
});

describe("sanitizeProofreadOptions", () => {
  it("falls back to the documented defaults when no overrides are given", () => {
    expect(sanitizeProofreadOptions(undefined)).toEqual(
      DEFAULT_PROOFREAD_OPTIONS
    );
    expect(sanitizeProofreadOptions(null)).toEqual(DEFAULT_PROOFREAD_OPTIONS);
    expect(sanitizeProofreadOptions({})).toEqual(DEFAULT_PROOFREAD_OPTIONS);
  });

  it("applies a partial set of overrides, leaving the rest at their defaults", () => {
    const result = sanitizeProofreadOptions({
      longPauseMinSeconds: 1.2,
      joinToleranceSeconds: 0.5,
    });

    expect(result).toEqual({
      ...DEFAULT_PROOFREAD_OPTIONS,
      longPauseMinSeconds: 1.2,
      joinToleranceSeconds: 0.5,
    });
  });

  it("ignores non-finite or wrongly-typed values and falls back to the default", () => {
    const result = sanitizeProofreadOptions({
      longPauseMinSeconds: Number.NaN,
      shortCutoutMinSeconds: "0.3" as unknown as number,
      joinWindowSeconds: undefined,
    });

    expect(result).toEqual(DEFAULT_PROOFREAD_OPTIONS);
  });

  it("clamps a negative duration-like override to zero, but leaves silenceThresholdDb (normally negative) alone", () => {
    const result = sanitizeProofreadOptions({
      longPauseMinSeconds: -5,
      silenceThresholdDb: -50,
    });

    expect(result.longPauseMinSeconds).toBe(0);
    expect(result.silenceThresholdDb).toBe(-50);
  });
});

describe("classifyPerClipSpans", () => {
  const clip = { id: "clip-1", sourceStartTime: 0, sourceEndTime: 10 };

  // A single real 1.5s pause. ffmpeg's `d=` option is a MINIMUM, so which of
  // the two passes actually reports it depends on where `longPauseMinSeconds`
  // sits relative to 1.5s — that's exactly what the service asks ffmpeg for
  // (see `proofreadPerClipSpans`), simulated here by handing this function
  // the raw output each pass would have produced at a given floor.
  const rawWithPeriod = [
    "[silencedetect @ 0x1] silence_start: 4",
    "[silencedetect @ 0x1] silence_end: 5.5 | silence_duration: 1.5",
  ].join("\n");
  const rawEmpty = "";

  it("classifies the 1.5s pause as short-cutout under the default 2.0s long-pause floor", () => {
    // At d=2.0 ffmpeg's long pass wouldn't report a 1.5s period at all; at
    // d=0.15 the short pass does.
    const spans = classifyPerClipSpans(rawEmpty, rawWithPeriod, clip, 0, {
      longPauseMinSeconds: DEFAULT_PROOFREAD_OPTIONS.longPauseMinSeconds,
    });

    expect(spans).toHaveLength(1);
    expect(spans[0]!.type).toBe("short-cutout");
  });

  it("reclassifies the SAME 1.5s pause as long-pause once longPauseMinSeconds is lowered below it — proves the knob flows through", () => {
    // At d=1.0 the long pass now reports it too; the short-pass duplicate is
    // filtered back out by excludeLongPeriods so it isn't double-counted.
    const spans = classifyPerClipSpans(rawWithPeriod, rawWithPeriod, clip, 0, {
      longPauseMinSeconds: 1.0,
    });

    expect(spans).toHaveLength(1);
    expect(spans[0]!.type).toBe("long-pause");
  });
});

describe("classifyBoundarySpan", () => {
  // Sits just after the join point (1.0), not straddling it — only a loose
  // enough tolerance should count it as a boundary artifact.
  const rawOutput = [
    "[silencedetect @ 0x1] silence_start: 1.15",
    "[silencedetect @ 0x1] silence_end: 1.3 | silence_duration: 0.15",
  ].join("\n");
  const clipB = { id: "clip-b" };

  it("flags a boundary span when the tolerance reaches the detected period", () => {
    const spans = classifyBoundarySpan(rawOutput, 1, clipB, 42, 0.2);

    expect(spans).toEqual([
      {
        type: "boundary",
        videoTimestampSeconds: 42,
        clipId: "clip-b",
        clipRelativeOffsetSeconds: 0,
        durationSeconds: 0.15,
      },
    ]);
  });

  it("the SAME raw output produces no span once the tolerance is tightened — proves the knob flows through", () => {
    const spans = classifyBoundarySpan(rawOutput, 1, clipB, 42, 0.02);

    expect(spans).toEqual([]);
  });
});
