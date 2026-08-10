import { describe, it, expect } from "vitest";
import {
  computeBeatDrop,
  beatContainerId,
  type BeatDndVideo,
} from "./beat-dnd";

const videos: BeatDndVideo[] = [
  { id: "v1", beats: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  { id: "v2", beats: [{ id: "d" }] },
  { id: "v3", beats: [] },
];

describe("computeBeatDrop", () => {
  it("returns null when dropped on itself", () => {
    expect(computeBeatDrop({ activeId: "a", overId: "a", videos })).toBeNull();
  });

  it("returns null with no over target", () => {
    expect(computeBeatDrop({ activeId: "a", overId: null, videos })).toBeNull();
  });

  it("reorders downward within a video (non-adjacent)", () => {
    // Drag 'a' past 'c' → dnd-kit reports overId='c'. a should move after c.
    expect(computeBeatDrop({ activeId: "a", overId: "c", videos })).toEqual({
      beatId: "a",
      targetVideoId: "v1",
      beforeBeatId: null,
    });
  });

  it("reorders downward within a video to the adjacent beat", () => {
    // Drag 'a' past 'b' → a should move after b (before c).
    expect(computeBeatDrop({ activeId: "a", overId: "b", videos })).toEqual({
      beatId: "a",
      targetVideoId: "v1",
      beforeBeatId: "c",
    });
  });

  it("moves across videos onto another video's beat", () => {
    expect(computeBeatDrop({ activeId: "a", overId: "d", videos })).toEqual({
      beatId: "a",
      targetVideoId: "v2",
      beforeBeatId: "d",
    });
  });

  it("appends when dropped on a video's container", () => {
    expect(
      computeBeatDrop({
        activeId: "a",
        overId: beatContainerId("v2"),
        videos,
      })
    ).toEqual({
      beatId: "a",
      targetVideoId: "v2",
      beforeBeatId: null,
    });
  });

  it("moves into an empty video via its container", () => {
    expect(
      computeBeatDrop({
        activeId: "a",
        overId: beatContainerId("v3"),
        videos,
      })
    ).toEqual({
      beatId: "a",
      targetVideoId: "v3",
      beforeBeatId: null,
    });
  });

  it("reorders downward within a video (adjacent)", () => {
    // Drag 'b' past 'c' → dnd-kit reports overId='c'. b should move after c.
    expect(computeBeatDrop({ activeId: "b", overId: "c", videos })).toEqual({
      beatId: "b",
      targetVideoId: "v1",
      beforeBeatId: null,
    });
  });

  it("reorders upward within a video", () => {
    expect(computeBeatDrop({ activeId: "c", overId: "a", videos })).toEqual({
      beatId: "c",
      targetVideoId: "v1",
      beforeBeatId: "a",
    });
  });

  it("reorders upward to the immediately-preceding beat", () => {
    // 'b' onto 'a' → [a,b,c] becomes [b,a,c]; not a no-op.
    expect(computeBeatDrop({ activeId: "b", overId: "a", videos })).toEqual({
      beatId: "b",
      targetVideoId: "v1",
      beforeBeatId: "a",
    });
  });

  it("is a no-op when appending a beat that is already last", () => {
    expect(
      computeBeatDrop({
        activeId: "c",
        overId: beatContainerId("v1"),
        videos,
      })
    ).toBeNull();
  });
});
