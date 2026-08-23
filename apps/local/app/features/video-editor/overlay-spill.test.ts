import { describe, expect, it } from "vitest";
import type {
  ClipOnDatabase,
  DatabaseId,
  FrontendId,
} from "./clip-state-reducer";
import { BEAT_DURATION } from "./constants";
import type { ClipOverlay } from "./overlay-preview";
import {
  groupOverlaysByClip,
  toOverlaySpillClips,
  type OverlaySpillClip,
} from "./overlay-spill";

const clip = (
  databaseId: string,
  durationInSeconds: number
): OverlaySpillClip => ({ databaseId, durationInSeconds });

/** A Clip the preview cannot play and cannot measure. */
const unknownClip: OverlaySpillClip = {
  databaseId: null,
  durationInSeconds: null,
};

const overlay = (props: {
  clipId: string;
  at: number;
  durationInSeconds: number;
  id?: string;
}): ClipOverlay => ({
  id: props.id ?? "overlay-1",
  clipId: props.clipId,
  at: props.at,
  durationInSeconds: props.durationInSeconds,
  title: "A Definition Card",
  description: "What it means.",
});

describe("groupOverlaysByClip", () => {
  it("gives an Overlay that fits inside its Clip to that Clip only", () => {
    const byClip = groupOverlaysByClip(
      [clip("a", 10), clip("b", 10)],
      [overlay({ clipId: "a", at: 2, durationInSeconds: 5 })]
    );

    expect(byClip.get("a")).toEqual([
      expect.objectContaining({ at: 2, durationInSeconds: 5 }),
    ]);
    expect(byClip.get("b")).toBeUndefined();
  });

  it("carries an Overlay that outlives its Clip onto the next Clip", () => {
    const byClip = groupOverlaysByClip(
      [clip("a", 10), clip("b", 10)],
      [overlay({ clipId: "a", at: 8, durationInSeconds: 9 })]
    );

    expect(byClip.get("a")).toEqual([expect.objectContaining({ at: 8 })]);
    // Clip "b" starts 10s after Clip "a" does, so the card began 2s before it.
    expect(byClip.get("b")).toEqual([
      expect.objectContaining({ at: -2, durationInSeconds: 9 }),
    ]);
  });

  it("carries an Overlay across as many Clips as its duration reaches", () => {
    const byClip = groupOverlaysByClip(
      [clip("a", 4), clip("b", 4), clip("c", 4), clip("d", 4)],
      [overlay({ clipId: "a", at: 1, durationInSeconds: 10 })]
    );

    expect(byClip.get("a")).toEqual([expect.objectContaining({ at: 1 })]);
    expect(byClip.get("b")).toEqual([expect.objectContaining({ at: -3 })]);
    expect(byClip.get("c")).toEqual([expect.objectContaining({ at: -7 })]);
    // The card ends 11s in, and Clip "d" only starts at 12s.
    expect(byClip.get("d")).toBeUndefined();
  });

  it("stops an Overlay at the end of the Video", () => {
    const byClip = groupOverlaysByClip(
      [clip("a", 4)],
      [overlay({ clipId: "a", at: 1, durationInSeconds: 60 })]
    );

    expect(byClip.get("a")).toEqual([expect.objectContaining({ at: 1 })]);
    expect(byClip.size).toBe(1);
  });

  it("keeps every Overlay a Clip must draw, in timeline order", () => {
    const byClip = groupOverlaysByClip(
      [clip("a", 10), clip("b", 10)],
      [
        overlay({ id: "spills", clipId: "a", at: 8, durationInSeconds: 6 }),
        overlay({ id: "own", clipId: "b", at: 1, durationInSeconds: 5 }),
      ]
    );

    expect(byClip.get("b")?.map((each) => each.id)).toEqual(["spills", "own"]);
  });

  it("stops the walk at a Clip of unknown length", () => {
    const byClip = groupOverlaysByClip(
      [clip("a", 10), unknownClip, clip("c", 10)],
      [overlay({ clipId: "a", at: 8, durationInSeconds: 30 })]
    );

    expect(byClip.get("a")).toEqual([expect.objectContaining({ at: 8 })]);
    // Where Clip "c" starts cannot be known, so the card is not guessed onto it.
    expect(byClip.get("c")).toBeUndefined();
  });

  it("drops an Overlay whose anchor Clip is not on the timeline", () => {
    const byClip = groupOverlaysByClip(
      [clip("a", 10)],
      [overlay({ clipId: "archived", at: 1, durationInSeconds: 5 })]
    );

    expect(byClip.size).toBe(0);
  });
});

const databaseClip = (props: {
  databaseId: string;
  sourceStartTime: number;
  sourceEndTime: number;
  pauseType: ClipOnDatabase["pauseType"];
}): ClipOnDatabase => ({
  type: "on-database",
  frontendId: `frontend-${props.databaseId}` as FrontendId,
  databaseId: props.databaseId as DatabaseId,
  videoFilename: "take.mkv",
  sourceStartTime: props.sourceStartTime,
  sourceEndTime: props.sourceEndTime,
  text: "",
  transcribedAt: null,
  scene: null,
  profile: null,
  insertionOrder: null,
  pauseType: props.pauseType,
  zoomType: "none",
  diagramSnapshotId: null,
  diagramName: null,
  webLinks: [],
});

describe("toOverlaySpillClips", () => {
  it("measures a Clip by its own source window", () => {
    expect(
      toOverlaySpillClips([
        databaseClip({
          databaseId: "a",
          sourceStartTime: 5,
          sourceEndTime: 13,
          pauseType: "none",
        }),
      ])
    ).toEqual([{ databaseId: "a", durationInSeconds: 8 }]);
  });

  it("counts the Beat a long pause adds after the Clip", () => {
    expect(
      toOverlaySpillClips([
        databaseClip({
          databaseId: "a",
          sourceStartTime: 0,
          sourceEndTime: 8,
          pauseType: "long",
        }),
      ])
    ).toEqual([{ databaseId: "a", durationInSeconds: 8 + BEAT_DURATION }]);
  });
});
