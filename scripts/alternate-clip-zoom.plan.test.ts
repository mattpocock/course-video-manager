import { describe, expect, it } from "vitest";
import {
  planZoomAlternation,
  type PlannedClip,
  type ZoomChange,
} from "./alternate-clip-zoom.plan";

/** A Clip in whatever scene, carrying whatever zoom, with a readable id. */
const clip = (
  id: string,
  scene: string | null,
  zoomType = "none"
): PlannedClip => ({ id, scene, zoomType });

const camera = (id: string, zoomType = "none") => clip(id, "Camera", zoomType);
const code = (id: string) => clip(id, "Code");

/**
 * Apply a plan to the Clips it was built from, so a test can assert the
 * RESULTING timeline rather than a list of diffs. Reading "none, subtle, none"
 * is how the rule is actually judged.
 */
const applyPlan = (
  clips: readonly PlannedClip[],
  changes: readonly ZoomChange[]
): string[] => {
  const byId = new Map(changes.map((c) => [c.clipId, c.to]));
  return clips.map((c) => byId.get(c.id) ?? c.zoomType);
};

const zoomsAfterPlanning = (clips: readonly PlannedClip[]): string[] =>
  applyPlan(clips, planZoomAlternation(clips));

describe("planZoomAlternation", () => {
  describe("runs of two or more camera clips", () => {
    it("alternates along a run, starting as filmed", () => {
      const clips = [camera("a"), camera("b"), camera("c"), camera("d")];

      expect(zoomsAfterPlanning(clips)).toEqual([
        "none",
        "subtle",
        "none",
        "subtle",
      ]);
    });

    it("treats a pair as a run — the smallest case the rule covers", () => {
      const clips = [camera("a"), camera("b")];

      expect(zoomsAfterPlanning(clips)).toEqual(["none", "subtle"]);
    });

    it("restarts the alternation after another scene cuts in", () => {
      // Camera Camera | Code | Camera Camera. Each run is judged on its own, so
      // both start as filmed rather than carrying phase across the Code clip.
      const clips = [
        camera("a"),
        camera("b"),
        code("c"),
        camera("d"),
        camera("e"),
      ];

      expect(zoomsAfterPlanning(clips)).toEqual([
        "none",
        "subtle",
        "none",
        "none",
        "subtle",
      ]);
    });

    it("runs across the portrait camera scene too", () => {
      const clips = [
        clip("a", "TikTok Face"),
        clip("b", "TikTok Face"),
        clip("c", "TikTok Face"),
      ];

      expect(zoomsAfterPlanning(clips)).toEqual(["none", "subtle", "none"]);
    });
  });

  describe("what it leaves alone", () => {
    it("never touches a lone camera clip, even one already zoomed", () => {
      // The zoom exists to make a CUT interesting. A single camera clip
      // surrounded by code has no adjacent camera cut to play against, so a
      // hand-made choice there is the author's and survives the pass.
      const clips = [code("a"), camera("b", "subtle"), code("c")];

      expect(planZoomAlternation(clips)).toEqual([]);
    });

    it("never touches a clip that cannot be zoomed", () => {
      const clips = [
        code("a"),
        clip("b", "No Face"),
        clip("c", null),
        clip("d", ""),
      ];

      expect(planZoomAlternation(clips)).toEqual([]);
    });

    it("does not let a scene-less clip join a run", () => {
      // ~4,500 clips predate scene capture. One sitting between two camera
      // clips breaks the run rather than silently extending it, so neither
      // neighbour is left alternating against a clip that cannot be zoomed.
      const clips = [camera("a"), clip("b", null), camera("c")];

      expect(planZoomAlternation(clips)).toEqual([]);
    });
  });

  describe("the diff it reports", () => {
    it("proposes nothing when the timeline already obeys the rule", () => {
      const clips = [camera("a"), camera("b", "subtle"), camera("c")];

      expect(planZoomAlternation(clips)).toEqual([]);
    });

    it("is idempotent — a second pass over the result is empty", () => {
      const clips = [
        camera("a", "subtle"),
        camera("b"),
        camera("c", "subtle"),
        code("d"),
        camera("e"),
        camera("f"),
      ];

      const settled = zoomsAfterPlanning(clips).map((zoomType, i) =>
        clip(clips[i]!.id, clips[i]!.scene, zoomType)
      );

      expect(planZoomAlternation(settled)).toEqual([]);
    });

    it("clears a zoom that the alternation puts on an even position", () => {
      const clips = [camera("a", "subtle"), camera("b", "subtle")];

      expect(planZoomAlternation(clips)).toEqual([
        {
          clipId: "a",
          from: "subtle",
          to: "none",
          runLength: 2,
          indexInRun: 0,
        },
      ]);
    });

    it("reports the run each change belongs to, for the printed plan", () => {
      const changes = planZoomAlternation([
        camera("a"),
        camera("b"),
        camera("c"),
      ]);

      expect(changes).toEqual([
        {
          clipId: "b",
          from: "none",
          to: "subtle",
          runLength: 3,
          indexInRun: 1,
        },
      ]);
    });

    it("reads an unknown zoom value as no zoom", () => {
      const clips = [camera("a", "wildly-zoomed"), camera("b")];

      // "a" already renders as filmed, so only "b" needs changing.
      expect(planZoomAlternation(clips).map((c) => c.clipId)).toEqual(["b"]);
    });
  });

  it("has nothing to say about an empty video", () => {
    expect(planZoomAlternation([])).toEqual([]);
  });
});
