import { describe, it, expect } from "vitest";
import { isHeadPreserved, type Snapshot } from "./snapshot-list";

const snapshot = (over: Partial<Snapshot>): Snapshot => ({
  id: "s1",
  diagramId: "d1",
  scene: null,
  contentHash: "aaa",
  preserved: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("isHeadPreserved", () => {
  it("is true when a preserved snapshot already holds the head's content", () => {
    expect(isHeadPreserved([snapshot({ contentHash: "aaa" })], "aaa")).toBe(
      true
    );
  });

  it("is false when the only matching snapshot is not preserved", () => {
    // An auto-pinned snapshot can be archived out from under the head, so it is
    // not a safe place for work to live.
    expect(
      isHeadPreserved(
        [snapshot({ contentHash: "aaa", preserved: false })],
        "aaa"
      )
    ).toBe(false);
  });

  it("is false when the head has no content hash at all", () => {
    // The guard that matters: a snapshot's contentHash is a string, so without
    // the null check a null head would still have to not match — but treating
    // "unknown" as "safe" is the failure that loses work silently.
    expect(isHeadPreserved([snapshot({})], null)).toBe(false);
  });

  it("is false when there are no snapshots", () => {
    expect(isHeadPreserved([], "aaa")).toBe(false);
  });
});
