import { describe, it, expect } from "vitest";
import { getPostedPlatforms, getShortStatus } from "./short-status";

const POSTED = new Date("2026-01-01T00:00:00Z");

describe("getPostedPlatforms", () => {
  it("counts a youtube-shorts post as posted to YouTube", () => {
    expect(
      getPostedPlatforms([{ platform: "youtube-shorts", postedAt: POSTED }])
    ).toEqual({ youtube: true, tiktok: false });
  });

  it("counts a buffer post as posted to TikTok", () => {
    expect(
      getPostedPlatforms([{ platform: "buffer", postedAt: POSTED }])
    ).toEqual({ youtube: false, tiktok: true });
  });

  it("does not count a Video Post that has not been posted yet", () => {
    expect(
      getPostedPlatforms([
        { platform: "youtube-shorts", postedAt: null },
        { platform: "buffer", postedAt: null },
      ])
    ).toEqual({ youtube: false, tiktok: false });
  });

  it("gives the same answer to the Shorts grid and the posting modal", () => {
    const posts = [
      { platform: "buffer", postedAt: POSTED },
      { platform: "youtube-shorts", postedAt: null },
    ];
    const posted = getPostedPlatforms(posts);

    expect(getShortStatus("v1", { v1: true }, { v1: posted })).toBe("posted");
    expect(posted.tiktok).toBe(true);
  });
});
