import { describe, it, expect } from "vitest";
import { getVideoFilePath, isUrl } from "./video-files";

describe("isUrl", () => {
  it("returns true for https URLs", () => {
    expect(isUrl("https://res.cloudinary.com/test/image.png")).toBe(true);
  });

  it("returns true for http URLs", () => {
    expect(isUrl("http://example.com/file.png")).toBe(true);
  });

  it("returns false for local filenames", () => {
    expect(isUrl("image.png")).toBe(false);
    expect(isUrl("thumbnail-abc.png")).toBe(false);
    expect(isUrl("./relative/path.png")).toBe(false);
    expect(isUrl("/absolute/path.png")).toBe(false);
  });
});

describe("getVideoFilePath", () => {
  it("returns directory path keyed by lineageId when no filename given", () => {
    const result = getVideoFilePath("lineage-abc-123");
    expect(result).toContain("video-files");
    expect(result).toContain("lineage-abc-123");
    expect(result).not.toContain("standalone");
  });

  it("joins local filename with lineageId directory", () => {
    const result = getVideoFilePath("lineage-abc-123", "image.png");
    expect(result).toContain("lineage-abc-123");
    expect(result).toContain("image.png");
  });

  it("returns URL as-is when filename is an https URL", () => {
    const url =
      "https://res.cloudinary.com/total-typescript/image/upload/v1772100428/ai-hero-images/alyzcymusoj0qby2wfhc.png";
    const result = getVideoFilePath("lineage-abc-123", url);
    expect(result).toBe(url);
  });

  it("returns URL as-is when filename is an http URL", () => {
    const url = "http://example.com/image.png";
    const result = getVideoFilePath("lineage-abc-123", url);
    expect(result).toBe(url);
  });
});
