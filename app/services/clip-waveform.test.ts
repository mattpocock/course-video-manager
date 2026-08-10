import { describe, it, expect } from "vitest";
import {
  computeClipOffsets,
  computeContextWindow,
  sanitizeWaveformOptions,
} from "./clip-waveform.server";

describe("computeClipOffsets", () => {
  it("returns cumulative offsets, ignoring source gaps between clips", () => {
    const clips = [
      {
        id: "a",
        videoFilename: "f.mkv",
        sourceStartTime: 10,
        sourceEndTime: 15,
        text: "",
      }, // 5s
      {
        id: "b",
        videoFilename: "f.mkv",
        sourceStartTime: 50,
        sourceEndTime: 53,
        text: "",
      }, // 3s
      {
        id: "c",
        videoFilename: "g.mkv",
        sourceStartTime: 0,
        sourceEndTime: 2,
        text: "",
      }, // 2s
    ];

    const offsets = computeClipOffsets(clips);

    expect(offsets).toEqual([
      { clipId: "a", videoStartSeconds: 0, durationSeconds: 5 },
      { clipId: "b", videoStartSeconds: 5, durationSeconds: 3 },
      { clipId: "c", videoStartSeconds: 8, durationSeconds: 2 },
    ]);
  });

  it("returns an empty list for no clips", () => {
    expect(computeClipOffsets([])).toEqual([]);
  });

  it("clamps a degenerate (non-positive) clip duration to zero instead of pushing later clips backwards", () => {
    const clips = [
      {
        id: "a",
        videoFilename: "f.mkv",
        sourceStartTime: 5,
        sourceEndTime: 5, // zero-length
        text: "",
      },
      {
        id: "b",
        videoFilename: "f.mkv",
        sourceStartTime: 20,
        sourceEndTime: 15, // end before start — degenerate
        text: "",
      },
      {
        id: "c",
        videoFilename: "f.mkv",
        sourceStartTime: 0,
        sourceEndTime: 4,
        text: "",
      },
    ];

    expect(computeClipOffsets(clips)).toEqual([
      { clipId: "a", videoStartSeconds: 0, durationSeconds: 0 },
      { clipId: "b", videoStartSeconds: 0, durationSeconds: 0 },
      { clipId: "c", videoStartSeconds: 0, durationSeconds: 4 },
    ]);
  });
});

describe("sanitizeWaveformOptions", () => {
  it("falls back to the documented defaults when no overrides are given", () => {
    expect(sanitizeWaveformOptions(undefined)).toEqual({
      pxPerSecond: 40,
      height: 64,
      contextSeconds: 5,
      gainDb: 12,
    });
    expect(sanitizeWaveformOptions(null)).toEqual({
      pxPerSecond: 40,
      height: 64,
      contextSeconds: 5,
      gainDb: 12,
    });
    expect(sanitizeWaveformOptions({})).toEqual({
      pxPerSecond: 40,
      height: 64,
      contextSeconds: 5,
      gainDb: 12,
    });
  });

  it("applies valid overrides", () => {
    expect(
      sanitizeWaveformOptions({
        pxPerSecond: 80,
        height: 120,
        contextSeconds: 10,
        gainDb: 20,
      })
    ).toEqual({
      pxPerSecond: 80,
      height: 120,
      contextSeconds: 10,
      gainDb: 20,
    });
  });

  it("ignores non-finite or wrongly-typed values and falls back to the default", () => {
    expect(
      sanitizeWaveformOptions({
        pxPerSecond: Number.NaN,
        height: "64" as unknown as number,
        contextSeconds: Number.NaN,
        gainDb: undefined,
      })
    ).toEqual({ pxPerSecond: 40, height: 64, contextSeconds: 5, gainDb: 12 });
  });

  it("clamps an out-of-range override into the sane positive range instead of passing it straight to ffmpeg", () => {
    expect(
      sanitizeWaveformOptions({ pxPerSecond: -50, height: 100000 })
    ).toEqual({ pxPerSecond: 2, height: 400, contextSeconds: 5, gainDb: 12 });

    expect(
      sanitizeWaveformOptions({ pxPerSecond: 100000, height: -50 })
    ).toEqual({ pxPerSecond: 400, height: 16, contextSeconds: 5, gainDb: 12 });
  });

  it("clamps gainDb into its own range independently of the other knobs — negative gain (attenuation) is allowed, but bounded", () => {
    expect(sanitizeWaveformOptions({ gainDb: -100 })).toEqual({
      pxPerSecond: 40,
      height: 64,
      contextSeconds: 5,
      gainDb: -24,
    });
    expect(sanitizeWaveformOptions({ gainDb: 1000 })).toEqual({
      pxPerSecond: 40,
      height: 64,
      contextSeconds: 5,
      gainDb: 48,
    });
  });

  it("clamps contextSeconds into 0..30, including negative overrides down to 0", () => {
    expect(sanitizeWaveformOptions({ contextSeconds: -5 })).toEqual({
      pxPerSecond: 40,
      height: 64,
      contextSeconds: 0,
      gainDb: 12,
    });
    expect(sanitizeWaveformOptions({ contextSeconds: 1000 })).toEqual({
      pxPerSecond: 40,
      height: 64,
      contextSeconds: 30,
      gainDb: 12,
    });
  });
});

describe("computeContextWindow", () => {
  it("returns null when there's no neighbor (first clip has no tail, last clip has no head)", () => {
    expect(computeContextWindow(undefined, 5, "tail")).toBeNull();
    expect(computeContextWindow(undefined, 5, "head")).toBeNull();
  });

  it("takes the last contextSeconds of a tail (previous clip) window", () => {
    const prevClip = {
      videoFilename: "a.mkv",
      sourceStartTime: 10,
      sourceEndTime: 40, // 30s clip
    };

    expect(computeContextWindow(prevClip, 5, "tail")).toEqual({
      file: "a.mkv",
      startTime: 35,
      duration: 5,
    });
  });

  it("takes the first contextSeconds of a head (next clip) window", () => {
    const nextClip = {
      videoFilename: "b.mkv",
      sourceStartTime: 100,
      sourceEndTime: 130, // 30s clip
    };

    expect(computeContextWindow(nextClip, 5, "head")).toEqual({
      file: "b.mkv",
      startTime: 100,
      duration: 5,
    });
  });

  it("clamps to the neighbor's own duration when it's shorter than contextSeconds, rather than reading past its bounds", () => {
    const shortPrevClip = {
      videoFilename: "a.mkv",
      sourceStartTime: 10,
      sourceEndTime: 12.5, // only 2.5s long
    };

    // Tail: clamped duration starts exactly at the clip's own start.
    expect(computeContextWindow(shortPrevClip, 5, "tail")).toEqual({
      file: "a.mkv",
      startTime: 10,
      duration: 2.5,
    });

    const shortNextClip = {
      videoFilename: "b.mkv",
      sourceStartTime: 100,
      sourceEndTime: 101.25, // only 1.25s long
    };

    // Head: clamped duration still starts at the clip's own start.
    expect(computeContextWindow(shortNextClip, 5, "head")).toEqual({
      file: "b.mkv",
      startTime: 100,
      duration: 1.25,
    });
  });

  it("returns null for a degenerate (zero or negative duration) neighbor", () => {
    const zeroLength = {
      videoFilename: "a.mkv",
      sourceStartTime: 10,
      sourceEndTime: 10,
    };
    const negativeLength = {
      videoFilename: "a.mkv",
      sourceStartTime: 20,
      sourceEndTime: 15,
    };

    expect(computeContextWindow(zeroLength, 5, "tail")).toBeNull();
    expect(computeContextWindow(negativeLength, 5, "head")).toBeNull();
  });

  it("returns null when contextSeconds is 0 or negative, even with a healthy neighbor", () => {
    const clip = {
      videoFilename: "a.mkv",
      sourceStartTime: 0,
      sourceEndTime: 30,
    };

    expect(computeContextWindow(clip, 0, "tail")).toBeNull();
    expect(computeContextWindow(clip, -5, "head")).toBeNull();
  });
});
