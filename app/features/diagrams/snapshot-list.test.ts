import { describe, it, expect } from "vitest";
import { isHeadCaptured, type Snapshot } from "./snapshot-list";

const snapshot = (over: Partial<Snapshot>): Snapshot => ({
  id: "s1",
  diagramId: "d1",
  scene: null,
  contentHash: "aaa",
  preserved: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("isHeadCaptured", () => {
  it("is true when a preserved snapshot already holds the head's content", () => {
    expect(isHeadCaptured([snapshot({ contentHash: "aaa" })], "aaa")).toBe(
      true
    );
  });

  it("is true when the only matching snapshot is Clip-pinned rather than preserved", () => {
    // The endpoint has already dropped everything that left the timeline, so a
    // non-preserved snapshot still in this list is one click away — restoring
    // over the head loses nothing. Stepping relies on this: without it, landing
    // on a Clip-pinned snapshot makes the next keypress warn about the snapshot
    // it just landed on.
    expect(
      isHeadCaptured(
        [snapshot({ contentHash: "aaa", preserved: false })],
        "aaa"
      )
    ).toBe(true);
  });

  it("is false when no snapshot on the timeline holds the head's content", () => {
    expect(isHeadCaptured([snapshot({ contentHash: "bbb" })], "aaa")).toBe(
      false
    );
  });

  it("is false when the head has no content hash at all", () => {
    // The guard that matters: a snapshot's contentHash is a string, so without
    // the null check a null head would still have to not match — but treating
    // "unknown" as "safe" is the failure that loses work silently.
    expect(isHeadCaptured([snapshot({})], null)).toBe(false);
  });

  it("is false when there are no snapshots", () => {
    expect(isHeadCaptured([], "aaa")).toBe(false);
  });
});
