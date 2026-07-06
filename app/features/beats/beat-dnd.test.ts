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

  it("reorders within a video, inserting before the hovered beat", () => {
    expect(computeBeatDrop({ activeId: "a", overId: "c", videos })).toEqual({
      beatId: "a",
      targetVideoId: "v1",
      beforeBeatId: "c",
    });
  });

  it("is a no-op when dropping before the immediately-following beat", () => {
    // 'a' is already right before 'b' — landing before 'b' changes nothing.
    expect(computeBeatDrop({ activeId: "a", overId: "b", videos })).toBeNull();
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
