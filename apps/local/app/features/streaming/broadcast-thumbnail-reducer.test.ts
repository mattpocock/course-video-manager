import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  broadcastThumbnailReport,
  broadcastThumbnailReducer,
  createInitialBroadcastThumbnailState,
} from "./broadcast-thumbnail-reducer";
import type { NewBroadcastVideo } from "./new-stream-video";

const video: NewBroadcastVideo = {
  id: "video-1",
  title: "Office hours #12",
  description: null,
  thumbnails: [
    { id: "newest", selectedForUpload: false },
    { id: "chosen", selectedForUpload: true },
  ],
};

const start = () =>
  new ReducerTester(
    broadcastThumbnailReducer,
    createInitialBroadcastThumbnailState(video)
  );

describe("a picked Broadcast's thumbnail, set later", () => {
  it("opens on the Video's thumbnail selected for upload, and sets the one picked on the picked Broadcast once", () => {
    const tester = start().send({ type: "thumbnail-clicked" });

    expect(tester.getState()).toMatchObject({
      open: true,
      thumbnailId: "chosen",
    });

    tester
      .send({ type: "thumbnail-picked", thumbnailId: "newest" })
      .send({ type: "set-clicked", broadcastId: "picked-one" })
      .send({ type: "set-clicked", broadcastId: "picked-one" });

    expect(tester.getState().setting).toBe(true);
    expect(tester.getEffects()).toEqual([
      {
        type: "set-broadcast-thumbnail",
        videoId: "video-1",
        broadcastId: "picked-one",
        thumbnailId: "newest",
      },
    ]);
  });

  it("sets nothing with no thumbnail picked", () => {
    const tester = start()
      .send({ type: "thumbnail-clicked" })
      .send({ type: "thumbnail-picked", thumbnailId: null })
      .send({ type: "set-clicked", broadcastId: "picked-one" });

    expect(tester.getEffects()).toEqual([]);
  });

  it("says the thumbnail was set, or why not until the next press, for the Broadcast it was set on", () => {
    const tester = start()
      .send({ type: "thumbnail-clicked" })
      .send({ type: "set-clicked", broadcastId: "picked-one" })
      .send({
        type: "set-answered",
        result: { status: "failed", reason: "Custom thumbnails not allowed" },
      });

    expect(broadcastThumbnailReport(tester.getState(), "picked-one")).toEqual({
      ok: false,
      words:
        "The thumbnail could not be set (Custom thumbnails not allowed): try again, or set it in YouTube Studio.",
    });
    // Another Broadcast picked since: not its news.
    expect(broadcastThumbnailReport(tester.getState(), "another")).toBeNull();

    tester.send({ type: "set-clicked", broadcastId: "picked-one" });
    expect(
      broadcastThumbnailReport(tester.getState(), "picked-one")
    ).toBeNull();

    tester.send({ type: "set-failed", message: "Failed to fetch" });
    expect(broadcastThumbnailReport(tester.getState(), "picked-one")?.ok).toBe(
      false
    );

    tester
      .send({ type: "set-clicked", broadcastId: "picked-one" })
      .send({ type: "set-answered", result: { status: "set" } });
    expect(broadcastThumbnailReport(tester.getState(), "picked-one")).toEqual({
      ok: true,
      words: "Thumbnail set.",
    });
  });
});
