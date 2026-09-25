import { describe, it, expect } from "vitest";
import {
  computeClipMockupDrop,
  CLIP_MOCKUP_CONTAINER_ID,
} from "./clip-mockup-dnd";

const clipMockupIds = ["a", "b", "c", "d"];

describe("computeClipMockupDrop", () => {
  it("returns null when dropped on itself", () => {
    expect(
      computeClipMockupDrop({ activeId: "a", overId: "a", clipMockupIds })
    ).toBeNull();
  });

  it("returns null with no over target", () => {
    expect(
      computeClipMockupDrop({ activeId: "a", overId: null, clipMockupIds })
    ).toBeNull();
  });

  it("returns null for an unknown dragged row", () => {
    expect(
      computeClipMockupDrop({ activeId: "zz", overId: "b", clipMockupIds })
    ).toBeNull();
  });

  it("returns null for an unknown drop target", () => {
    expect(
      computeClipMockupDrop({ activeId: "a", overId: "zz", clipMockupIds })
    ).toBeNull();
  });

  it("returns null when the row is dropped where it already sits", () => {
    // Dragging 'a' onto 'b' would anchor before 'b' — which is exactly where
    // 'a' already is.
    expect(
      computeClipMockupDrop({ activeId: "b", overId: "b", clipMockupIds })
    ).toBeNull();
  });

  it("reorders upward: dropping on an earlier row anchors before it", () => {
    expect(
      computeClipMockupDrop({ activeId: "d", overId: "b", clipMockupIds })
    ).toEqual({ clipMockupId: "d", beforeClipMockupId: "b" });
  });

  it("reorders downward to the adjacent row", () => {
    // Drag 'a' past 'b' → it should land after 'b', i.e. before 'c'.
    expect(
      computeClipMockupDrop({ activeId: "a", overId: "b", clipMockupIds })
    ).toEqual({ clipMockupId: "a", beforeClipMockupId: "c" });
  });

  it("reorders downward past the last row (append)", () => {
    expect(
      computeClipMockupDrop({ activeId: "a", overId: "d", clipMockupIds })
    ).toEqual({ clipMockupId: "a", beforeClipMockupId: null });
  });

  it("appends when dropped on the container", () => {
    expect(
      computeClipMockupDrop({
        activeId: "a",
        overId: CLIP_MOCKUP_CONTAINER_ID,
        clipMockupIds,
      })
    ).toEqual({ clipMockupId: "a", beforeClipMockupId: null });
  });

  it("is a no-op when the last row is dropped on the container", () => {
    expect(
      computeClipMockupDrop({
        activeId: "d",
        overId: CLIP_MOCKUP_CONTAINER_ID,
        clipMockupIds,
      })
    ).toBeNull();
  });

  it("moves the first row to the front of a two-row list only when it changes", () => {
    expect(
      computeClipMockupDrop({
        activeId: "b",
        overId: "a",
        clipMockupIds: ["a", "b"],
      })
    ).toEqual({ clipMockupId: "b", beforeClipMockupId: "a" });
  });
});
