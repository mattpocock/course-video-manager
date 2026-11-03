import { describe, it, expect } from "vitest";
import {
  getPostedPlatforms,
  getShortQueueStates,
  getShortStatus,
} from "./short-status";

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

    expect(getShortStatus("v1", { v1: true }, { v1: posted }, {})).toBe(
      "posted"
    );
    expect(posted.tiktok).toBe(true);
  });
});

describe("getShortStatus with the Posting Queue", () => {
  const NONE = { youtube: false, tiktok: false };

  it("goes Recorded, Exported, Queued, Posted", () => {
    const queue = getShortQueueStates([{ videoId: "queued", state: "queued" }]);
    const exported = { exported: true, queued: true, posted: true };
    const posted = {
      exported: NONE,
      queued: NONE,
      posted: { youtube: true, tiktok: true },
    };

    expect(
      ["recorded", "exported", "queued", "posted"].map((id) =>
        getShortStatus(id, exported, posted, queue)
      )
    ).toEqual(["recorded", "exported", "queued", "posted"]);
  });

  it("a Short posting or held is still Queued, even once one channel has it", () => {
    const queue = getShortQueueStates([
      { videoId: "posting", state: "posting" },
      { videoId: "held", state: "held" },
    ]);
    const halfPosted = { youtube: true, tiktok: false };

    expect(getShortStatus("posting", {}, { posting: halfPosted }, queue)).toBe(
      "queued"
    );
    expect(getShortStatus("held", {}, {}, queue)).toBe("queued");
  });

  it("a Failed entry reads Failed, until the Short is queued again", () => {
    const failedOnly = getShortQueueStates([
      { videoId: "v1", state: "failed" },
    ]);
    const requeued = getShortQueueStates([
      { videoId: "v1", state: "queued" },
      { videoId: "v1", state: "failed" },
    ]);

    expect(getShortStatus("v1", { v1: true }, {}, failedOnly)).toBe("failed");
    expect(getShortStatus("v1", { v1: true }, {}, requeued)).toBe("queued");
  });
});
