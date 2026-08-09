import { describe, it, expect } from "vitest";
import {
  computeClipOffsets,
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
      }, // 5s
      {
        id: "b",
        videoFilename: "f.mkv",
        sourceStartTime: 50,
        sourceEndTime: 53,
      }, // 3s
      { id: "c", videoFilename: "g.mkv", sourceStartTime: 0, sourceEndTime: 2 }, // 2s
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
      },
      {
        id: "b",
        videoFilename: "f.mkv",
        sourceStartTime: 20,
        sourceEndTime: 15, // end before start — degenerate
      },
      {
        id: "c",
        videoFilename: "f.mkv",
        sourceStartTime: 0,
        sourceEndTime: 4,
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
    });
    expect(sanitizeWaveformOptions(null)).toEqual({
      pxPerSecond: 40,
      height: 64,
    });
    expect(sanitizeWaveformOptions({})).toEqual({
      pxPerSecond: 40,
      height: 64,
    });
  });

  it("applies valid overrides", () => {
    expect(sanitizeWaveformOptions({ pxPerSecond: 80, height: 120 })).toEqual({
      pxPerSecond: 80,
      height: 120,
    });
  });

  it("ignores non-finite or wrongly-typed values and falls back to the default", () => {
    expect(
      sanitizeWaveformOptions({
        pxPerSecond: Number.NaN,
        height: "64" as unknown as number,
      })
    ).toEqual({ pxPerSecond: 40, height: 64 });
  });

  it("clamps an out-of-range override into the sane positive range instead of passing it straight to ffmpeg", () => {
    expect(
      sanitizeWaveformOptions({ pxPerSecond: -50, height: 100000 })
    ).toEqual({ pxPerSecond: 2, height: 400 });

    expect(
      sanitizeWaveformOptions({ pxPerSecond: 100000, height: -50 })
    ).toEqual({ pxPerSecond: 400, height: 16 });
  });
});
