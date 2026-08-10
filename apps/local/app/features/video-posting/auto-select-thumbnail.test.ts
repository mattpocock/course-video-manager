import { describe, it, expect } from "vitest";
import { getAutoSelectThumbnailId } from "./auto-select-thumbnail";

describe("getAutoSelectThumbnailId", () => {
  it("returns the thumbnail id when there is exactly one thumbnail", () => {
    expect(getAutoSelectThumbnailId([{ id: "thumb-1" }])).toBe("thumb-1");
  });

  it("returns null when there are multiple thumbnails", () => {
    const thumbnails = [{ id: "thumb-1" }, { id: "thumb-2" }];
    expect(getAutoSelectThumbnailId(thumbnails)).toBeNull();
  });

  it("returns null when there are no thumbnails", () => {
    expect(getAutoSelectThumbnailId([])).toBeNull();
  });
});
