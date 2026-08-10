import { describe, it, expect } from "vitest";
import { buildQueueTreeLines } from "./queue-tree";

describe("buildQueueTreeLines", () => {
  it("returns just the video line for standalone videos", () => {
    const lines = buildQueueTreeLines(undefined, "my-video.mp4");
    expect(lines).toEqual([{ label: "my-video.mp4", level: 0, isVideo: true }]);
  });

  it("returns a full tree for course videos", () => {
    const lines = buildQueueTreeLines(
      ["React Course", "Getting Started", "Intro Lesson"],
      "intro-video.mp4"
    );
    expect(lines).toEqual([
      { label: "React Course", level: 0, isVideo: false },
      { label: "Getting Started", level: 1, isVideo: false },
      { label: "Intro Lesson", level: 2, isVideo: false },
      { label: "intro-video.mp4", level: 3, isVideo: true },
    ]);
  });

  it("handles a single-level context", () => {
    const lines = buildQueueTreeLines(["Course Only"], "video.mp4");
    expect(lines).toEqual([
      { label: "Course Only", level: 0, isVideo: false },
      { label: "video.mp4", level: 1, isVideo: true },
    ]);
  });

  it("handles empty contextParts array like standalone", () => {
    const lines = buildQueueTreeLines([], "video.mp4");
    expect(lines).toEqual([{ label: "video.mp4", level: 0, isVideo: true }]);
  });
});
