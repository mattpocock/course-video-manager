import { describe, expect, it } from "vitest";
import {
  computeSearchWindow,
  planCoarseSamples,
  planFineSampleGroups,
  planFineSamples,
  selectDistinctMoments,
  type FrameSample,
} from "./screenshot-search-window";
import type { IndexedClip } from "./types";

const clip = (
  index: number,
  start: number,
  end: number,
  videoFilename = "a.mkv"
): IndexedClip => ({
  index,
  sourceStartTime: start,
  sourceEndTime: end,
  videoFilename,
  text: `clip ${index}`,
});

describe("computeSearchWindow", () => {
  const clips = [
    clip(1, 0, 5),
    clip(2, 5, 10),
    clip(3, 10, 15),
    clip(4, 15, 20),
    clip(5, 20, 25),
    clip(6, 25, 30),
    clip(7, 30, 35),
  ];

  it("covers two clips either side of the named clip", () => {
    const window = computeSearchWindow(clips, 4);
    expect(window?.clips.map((c) => c.index)).toEqual([2, 3, 4, 5, 6]);
    expect(window?.namedClip.index).toBe(4);
  });

  it("truncates at the start of the video", () => {
    expect(computeSearchWindow(clips, 1)?.clips.map((c) => c.index)).toEqual([
      1, 2, 3,
    ]);
  });

  it("truncates at the end of the video", () => {
    expect(computeSearchWindow(clips, 7)?.clips.map((c) => c.index)).toEqual([
      5, 6, 7,
    ]);
  });

  it("excludes neighbours from a different source file", () => {
    const mixed = [
      clip(1, 0, 5, "a.mkv"),
      clip(2, 5, 10, "a.mkv"),
      clip(3, 0, 5, "b.mkv"),
      clip(4, 5, 10, "b.mkv"),
      clip(5, 10, 15, "b.mkv"),
    ];
    const window = computeSearchWindow(mixed, 3);
    expect(window?.videoFilename).toBe("b.mkv");
    expect(window?.clips.map((c) => c.index)).toEqual([3, 4, 5]);
  });

  it("returns null for an unknown clip index", () => {
    expect(computeSearchWindow(clips, 99)).toBeNull();
  });
});

describe("planCoarseSamples", () => {
  it("samples within each clip, never across the gaps between them", () => {
    // Clip 1 ends at 5s and clip 2 starts at 100s — the 95 seconds between
    // them was cut and must never be sampled.
    const window = computeSearchWindow([clip(1, 0, 5), clip(2, 100, 103)], 1)!;
    const timestamps = planCoarseSamples(window).map((s) => s.timestamp);

    expect(timestamps).toEqual([0, 1, 2, 3, 4, 5, 100, 101, 102, 103]);
    expect(timestamps.some((t) => t > 5 && t < 100)).toBe(false);
  });

  it("gives a short clip its midpoint rather than no frames at all", () => {
    const window = computeSearchWindow([clip(1, 10, 10.4)], 1)!;
    expect(planCoarseSamples(window)).toEqual([
      { timestamp: 10.2, clipIndex: 1, isNamedClip: true },
    ]);
  });

  it("marks which frames came from the named clip", () => {
    const window = computeSearchWindow([clip(1, 0, 2), clip(2, 2, 4)], 2)!;
    const samples = planCoarseSamples(window);
    expect(
      samples.filter((s) => s.isNamedClip).map((s) => s.timestamp)
    ).toEqual([2, 3, 4]);
  });
});

describe("planFineSamples", () => {
  it("samples either side of the coarse winner", () => {
    const window = computeSearchWindow([clip(1, 0, 10)], 1)!;
    const timestamps = planFineSamples(window, 5).map((s) =>
      Number(s.timestamp.toFixed(1))
    );
    expect(timestamps).toEqual([4.6, 4.8, 5, 5.2, 5.4]);
  });

  it("clamps to the winning clip, not into the footage cut beside it", () => {
    const window = computeSearchWindow([clip(1, 0, 5), clip(2, 100, 105)], 2)!;
    const timestamps = planFineSamples(window, 100.1).map((s) =>
      Number(s.timestamp.toFixed(1))
    );
    expect(timestamps.every((t) => t >= 100)).toBe(true);
    expect(timestamps).toEqual([100.1, 100.3, 100.5]);
  });

  it("always yields at least the centre frame", () => {
    const window = computeSearchWindow([clip(1, 10, 10.05)], 1)!;
    expect(planFineSamples(window, 10.025)).toHaveLength(1);
  });
});

describe("selectDistinctMoments", () => {
  const sample = (timestamp: number, clipIndex = 1): FrameSample => ({
    timestamp,
    clipIndex,
    isNamedClip: true,
  });

  it("keeps the highest-ranked of a cluster and drops the rest", () => {
    // Ranked best-first, all within a second of each other.
    const kept = selectDistinctMoments([
      sample(10),
      sample(10.5),
      sample(9.5),
      sample(11),
    ]);
    expect(kept.map((s) => s.timestamp)).toEqual([10]);
  });

  it("keeps moments that are far enough apart, in rank order", () => {
    const kept = selectDistinctMoments([sample(20), sample(10), sample(30)]);
    expect(kept.map((s) => s.timestamp)).toEqual([20, 10, 30]);
  });

  it("thins a realistic ranking down to distinct moments", () => {
    const kept = selectDistinctMoments([
      sample(12),
      sample(12.4),
      sample(30),
      sample(11.6),
      sample(41),
      sample(30.8),
    ]);
    expect(kept.map((s) => s.timestamp)).toEqual([12, 30, 41]);
  });

  it("never returns more than the grid holds", () => {
    const kept = selectDistinctMoments([
      sample(0),
      sample(10),
      sample(20),
      sample(30),
      sample(40),
      sample(50),
    ]);
    expect(kept).toHaveLength(4);
  });

  it("returns fewer than four rather than padding", () => {
    const kept = selectDistinctMoments([sample(5), sample(5.2)]);
    expect(kept.map((s) => s.timestamp)).toEqual([5]);
  });

  it("returns nothing when given nothing", () => {
    expect(selectDistinctMoments([])).toEqual([]);
  });

  it("respects the separation exactly at the boundary", () => {
    // Exactly two seconds apart counts as distinct; a hair under does not.
    expect(selectDistinctMoments([sample(10), sample(12)])).toHaveLength(2);
    expect(selectDistinctMoments([sample(10), sample(11.99)])).toHaveLength(1);
  });
});

describe("planFineSampleGroups", () => {
  const clips = [clip(1, 0, 10), clip(2, 10, 20), clip(3, 20, 30)];
  const window = computeSearchWindow(clips, 2)!;

  it("builds one group per candidate, centred on it", () => {
    const groups = planFineSampleGroups(window, [5, 15, 25]);
    expect(groups.map((g) => g.center)).toEqual([5, 15, 25]);
    expect(groups).toHaveLength(3);
  });

  it("clamps each group to the clip its candidate sits in", () => {
    // 9.9 is near the end of clip 1; nothing may spill into clip 2.
    const [group] = planFineSampleGroups(window, [9.9]);
    for (const s of group!.samples) {
      expect(s.timestamp).toBeLessThanOrEqual(10);
      expect(s.clipIndex).toBe(1);
    }
  });

  it("gives every group at least one frame", () => {
    const groups = planFineSampleGroups(window, [0, 15, 30]);
    for (const group of groups) {
      expect(group.samples.length).toBeGreaterThan(0);
    }
  });

  it("returns no groups when there are no candidates", () => {
    expect(planFineSampleGroups(window, [])).toEqual([]);
  });
});
