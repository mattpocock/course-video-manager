import { describe, it, expect } from "vitest";
import { isVisibleInTimeline } from "./timeline-visibility";

describe("isVisibleInTimeline", () => {
  it("returns true when snapshot is preserved and has no pinning clips", () => {
    const snapshot = { preserved: true };
    expect(isVisibleInTimeline(snapshot, [])).toBe(true);
  });

  it("returns true when snapshot is preserved and has pinning clips", () => {
    const snapshot = { preserved: true };
    const clips = [{ archived: false }];
    expect(isVisibleInTimeline(snapshot, clips)).toBe(true);
  });

  it("returns false when snapshot is not preserved and has no pinning clips", () => {
    const snapshot = { preserved: false };
    expect(isVisibleInTimeline(snapshot, [])).toBe(false);
  });

  it("returns false when snapshot is not preserved and all pinning clips are archived", () => {
    const snapshot = { preserved: false };
    const clips = [{ archived: true }, { archived: true }];
    expect(isVisibleInTimeline(snapshot, clips)).toBe(false);
  });

  it("returns true when snapshot is not preserved but has non-archived pinning clips", () => {
    const snapshot = { preserved: false };
    const clips = [{ archived: false }];
    expect(isVisibleInTimeline(snapshot, clips)).toBe(true);
  });

  it("returns true when snapshot is not preserved and has mix of archived and non-archived clips", () => {
    const snapshot = { preserved: false };
    const clips = [{ archived: true }, { archived: false }];
    expect(isVisibleInTimeline(snapshot, clips)).toBe(true);
  });

  it("archive cascade: archiving sole pinning clip hides non-preserved snapshot", () => {
    const snapshot = { preserved: false };
    const clipBeforeArchive = [{ archived: false }];
    expect(isVisibleInTimeline(snapshot, clipBeforeArchive)).toBe(true);

    const clipAfterArchive = [{ archived: true }];
    expect(isVisibleInTimeline(snapshot, clipAfterArchive)).toBe(false);
  });

  it("archive cascade: unarchiving clip restores snapshot visibility", () => {
    const snapshot = { preserved: false };
    const clipArchived = [{ archived: true }];
    expect(isVisibleInTimeline(snapshot, clipArchived)).toBe(false);

    const clipRestored = [{ archived: false }];
    expect(isVisibleInTimeline(snapshot, clipRestored)).toBe(true);
  });

  it("archive cascade: preserved snapshot stays visible even when all clips archived", () => {
    const snapshot = { preserved: true };
    const clips = [{ archived: true }];
    expect(isVisibleInTimeline(snapshot, clips)).toBe(true);
  });
});
