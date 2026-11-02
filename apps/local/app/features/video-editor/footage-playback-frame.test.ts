import { describe, expect, it } from "vitest";
import { footagePlaybackFrame } from "./footage-playback-frame";

describe("footagePlaybackFrame", () => {
  it("fills a Short's 9:16 frame, centre-cropped, as the export does (#2580)", () => {
    expect(footagePlaybackFrame("short")).toBe("cover-portrait");
  });

  it("leaves a Landscape Video's Footage at its own aspect", () => {
    expect(footagePlaybackFrame("landscape")).toBe("own-aspect");
  });
});
