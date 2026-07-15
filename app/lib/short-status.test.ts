import { describe, it, expect } from "vitest";
import { getShortStatus, STATUS_META, type ShortStatus } from "./short-status";

describe("getShortStatus", () => {
  it("returns 'posted' when the video has been posted", () => {
    expect(getShortStatus("v1", { v1: true }, { v1: true })).toBe("posted");
  });

  it("returns 'exported' when the video is exported but not posted", () => {
    expect(getShortStatus("v1", { v1: true }, { v1: false })).toBe("exported");
  });

  it("returns 'recorded' when the video is neither exported nor posted", () => {
    expect(getShortStatus("v1", { v1: false }, { v1: false })).toBe("recorded");
  });

  it("prefers 'posted' over 'exported'", () => {
    expect(getShortStatus("v1", { v1: true }, { v1: true })).toBe("posted");
  });

  it("returns 'recorded' for unknown video ids", () => {
    expect(getShortStatus("unknown", {}, {})).toBe("recorded");
  });
});

describe("STATUS_META", () => {
  const allStatuses: ShortStatus[] = ["recorded", "exported", "posted"];

  it("has an entry for every status", () => {
    for (const status of allStatuses) {
      expect(STATUS_META[status]).toBeDefined();
      expect(STATUS_META[status].label).toBeTruthy();
      expect(STATUS_META[status].icon).toBeTruthy();
    }
  });
});
