import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { Broadcast, NewBroadcastAnswer } from "./broadcast";
import {
  createInitialNewBroadcastState,
  newBroadcastReducer,
  newBroadcastReport,
} from "./new-broadcast-reducer";
import type { NewBroadcastVideo } from "./new-stream-video";

const video: NewBroadcastVideo = {
  id: "video-1",
  title: "Office hours #12",
  description: "Questions answered live.",
  thumbnails: [],
};

const start = (v: NewBroadcastVideo = video) =>
  new ReducerTester(newBroadcastReducer, createInitialNewBroadcastState(v));

const newOne: Broadcast = {
  id: "new-one",
  title: "Office hours #12",
  scheduledStartTime: "2026-11-04T10:05:00Z",
  enableAutoStart: true,
  enableAutoStop: true,
  liveChatId: "chat-new-one",
  boundStreamId: "keys-stream",
  latencyPreference: "ultraLow",
  privacyStatus: "unlisted",
};

const created = (
  o: Partial<Extract<NewBroadcastAnswer, { status: "created" }>> = {}
): NewBroadcastAnswer => ({
  status: "created",
  broadcast: newOne,
  monetization: { status: "off" },
  bind: { status: "bound" },
  thumbnail: { status: "none" },
  ...o,
});

describe("the New Broadcast form", () => {
  it("opens with the Video's title and description, Unlisted and Ultra-low", () => {
    const state = start().send({ type: "new-broadcast-clicked" }).getState();

    expect(state.open).toBe(true);
    expect(state.draft).toEqual({
      title: "Office hours #12",
      description: "Questions answered live.",
      privacyStatus: "unlisted",
      latencyPreference: "ultraLow",
      thumbnailId: null,
    });
  });

  it("preselects the Video's thumbnail selected for upload, else its only one, else none", () => {
    const thumbnailOf = (thumbnails: NewBroadcastVideo["thumbnails"]) =>
      start({ ...video, thumbnails })
        .send({ type: "new-broadcast-clicked" })
        .getState().draft.thumbnailId;

    expect(
      thumbnailOf([
        { id: "newest", selectedForUpload: false },
        { id: "chosen", selectedForUpload: true },
      ])
    ).toBe("chosen");
    expect(thumbnailOf([{ id: "only", selectedForUpload: false }])).toBe(
      "only"
    );
    expect(
      thumbnailOf([
        { id: "a", selectedForUpload: false },
        { id: "b", selectedForUpload: false },
      ])
    ).toBeNull();
  });

  it("defaults the description to empty for a Video that has none", () => {
    const state = start({
      ...video,
      title: "Stream 04/11/2026",
      description: null,
    })
      .send({ type: "new-broadcast-clicked" })
      .getState();

    expect(state.draft.description).toBe("");
  });

  it("creates the Broadcast once, as edited, however often Create is pressed", () => {
    const tester = start()
      .send({ type: "new-broadcast-clicked" })
      .send({ type: "title-edited", title: "Office hours: types" })
      .send({ type: "description-edited", description: "" })
      .send({ type: "privacy-picked", privacyStatus: "public" })
      .send({ type: "latency-picked", latencyPreference: "low" })
      .send({ type: "thumbnail-picked", thumbnailId: "thumb-2" })
      .send({ type: "create-clicked" })
      .send({ type: "create-clicked" });

    expect(tester.getState().submitting).toBe(true);
    expect(tester.getEffects()).toEqual([
      {
        type: "create-broadcast",
        videoId: "video-1",
        settings: {
          title: "Office hours: types",
          description: "",
          privacyStatus: "public",
          latencyPreference: "low",
          thumbnailId: "thumb-2",
        },
      },
    ]);

    tester
      .send({ type: "create-answered", answer: created() })
      .send({ type: "create-clicked" });

    // Created: the form shows what happened, and never creates a second one.
    expect(tester.getEffects()).toEqual([
      expect.objectContaining({ type: "create-broadcast" }),
      { type: "pick-created-broadcast", broadcast: newOne },
    ]);
  });

  it("creates nothing with a blank title", () => {
    const tester = start()
      .send({ type: "new-broadcast-clicked" })
      .send({ type: "title-edited", title: "   " })
      .send({ type: "create-clicked" });

    expect(tester.getEffects()).toEqual([]);
  });

  it("shows how monetization, the bind and the thumbnail went once created", () => {
    const report = (answer: NewBroadcastAnswer) =>
      newBroadcastReport(
        start()
          .send({ type: "new-broadcast-clicked" })
          .send({ type: "create-clicked" })
          .send({ type: "create-answered", answer })
          .getState()
      );

    expect(report(created())).toEqual({
      monetization: { ok: true, words: "Monetization: off" },
      bind: { ok: true, words: "Bound to the Stream Key's stream." },
      thumbnail: {
        ok: true,
        words: "No thumbnail: set one beside the picked Broadcast.",
      },
    });
    expect(
      report(created({ thumbnail: { status: "set" } }))?.thumbnail
    ).toEqual({ ok: true, words: "Thumbnail set." });
    expect(
      report(
        created({
          thumbnail: {
            status: "failed",
            reason: "Custom thumbnails not allowed",
          },
        })
      )?.thumbnail
    ).toEqual({
      ok: false,
      words:
        "The thumbnail could not be set (Custom thumbnails not allowed): set it beside the picked Broadcast, or in YouTube Studio.",
    });
    expect(
      report(
        created({
          monetization: { status: "not-eligible" },
          bind: { status: "not-bound", reason: "No Stream Key: add it." },
        })
      )
    ).toMatchObject({
      monetization: {
        ok: true,
        words:
          "Monetization: off (the channel is not in the YouTube Partner Program)",
      },
      bind: {
        ok: false,
        words: "Not bound to the Stream Key's stream: No Stream Key: add it.",
      },
    });
    expect(
      report(
        created({
          monetization: { status: "failed", message: "Backend Error" },
        })
      )?.monetization
    ).toEqual({
      ok: false,
      words:
        "Monetization could not be turned off (Backend Error): turn monetization off in YouTube Studio before going live.",
    });
  });

  it("says why the Broadcast was not created, and lets Matt try again", () => {
    const tester = start()
      .send({ type: "new-broadcast-clicked" })
      .send({ type: "create-clicked" })
      .send({ type: "create-failed", message: "Invalid latency preference" });

    expect(tester.getState()).toMatchObject({
      submitting: false,
      error: "Invalid latency preference",
    });
    expect(newBroadcastReport(tester.getState())).toBeNull();

    tester.send({ type: "create-clicked" });
    expect(tester.getState()).toMatchObject({ submitting: true, error: null });
    expect(tester.getEffects()).toHaveLength(2);
  });

  it("asks Matt to reconnect Google when YouTube needs it", () => {
    const state = start()
      .send({ type: "new-broadcast-clicked" })
      .send({ type: "create-clicked" })
      .send({
        type: "create-answered",
        answer: { status: "needs-reconnect", reason: "missing-live-access" },
      })
      .getState();

    expect(state.submitting).toBe(false);
    expect(state.error).toMatch(/Reconnect Google/);
  });

  it("starts afresh from the Video's defaults when opened again", () => {
    const state = start()
      .send({ type: "new-broadcast-clicked" })
      .send({ type: "title-edited", title: "Something else" })
      .send({ type: "create-clicked" })
      .send({ type: "create-answered", answer: created() })
      .send({ type: "form-dismissed" })
      .send({ type: "new-broadcast-clicked" })
      .getState();

    expect(state).toMatchObject({
      open: true,
      draft: { title: "Office hours #12" },
      created: null,
      error: null,
    });
  });
});
