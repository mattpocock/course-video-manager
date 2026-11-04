import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { Broadcast } from "./broadcast";
import {
  createInitialLiveStreamState,
  goLiveControl,
  liveStreamReducer,
} from "./live-stream-reducer";
import {
  unlistWhenEndedBesidePick,
  unlistWhenEndedOf,
} from "./unlist-when-ended";
import {
  createInitialNewBroadcastState,
  newBroadcastReducer,
  showsUnlistWhenEnded,
} from "./new-broadcast-reducer";

/**
 * **Unlist When Ended** (#2681): the per-Video preference, what End Stream
 * is sent, and an unlist that failed.
 */

const VIDEO = "video-1";
const OTHER_VIDEO = "video-2";

const broadcast = (
  id: string,
  privacyStatus: Broadcast["privacyStatus"]
): Broadcast => ({
  id,
  title: `Broadcast ${id}`,
  scheduledStartTime: "2026-10-31T18:00:00Z",
  enableAutoStart: true,
  enableAutoStop: true,
  liveChatId: `chat-${id}`,
  boundStreamId: null,
  latencyPreference: null,
  privacyStatus,
});

const start = () =>
  new ReducerTester(liveStreamReducer, createInitialLiveStreamState());

/** Live on VIDEO, the picked Broadcast of this privacy. */
const liveOn = (privacyStatus: Broadcast["privacyStatus"]) =>
  start()
    .send({
      type: "broadcasts-answered",
      answer: { status: "listed", broadcasts: [broadcast("b", privacyStatus)] },
    })
    .send({ type: "broadcast-clicked", broadcastId: "b" })
    .send({
      type: "live-stream-heard",
      stream: { videoId: VIDEO, status: { kind: "live" }, liveSince: null },
    });

const endStreamEffects = (tester: ReturnType<typeof start>) =>
  tester.getEffects().filter((e) => e.type === "end-stream");

describe("the Unlist When Ended preference", () => {
  it("is on by default, before it has been read", () => {
    expect(unlistWhenEndedOf(start().getState(), VIDEO)).toBe(true);
  });

  it("is read for the Video when its Streaming tab is shown, and a stored choice wins", () => {
    const tester = start().send({
      type: "streaming-tab-shown",
      videoId: VIDEO,
    });
    expect(tester.getEffects()).toEqual([
      { type: "read-unlist-preference", videoId: VIDEO },
    ]);

    tester.send({
      type: "unlist-preference-read",
      videoId: VIDEO,
      checked: false,
    });
    expect(unlistWhenEndedOf(tester.getState(), VIDEO)).toBe(false);
    expect(unlistWhenEndedOf(tester.getState(), OTHER_VIDEO)).toBe(true);
  });

  it("stays on when nothing was stored for the Video", () => {
    const tester = start()
      .send({ type: "streaming-tab-shown", videoId: VIDEO })
      .send({ type: "unlist-preference-read", videoId: VIDEO, checked: null });
    expect(unlistWhenEndedOf(tester.getState(), VIDEO)).toBe(true);
  });

  it("is saved per Video when toggled, and a late read doesn't undo the toggle", () => {
    const tester = start()
      .send({ type: "streaming-tab-shown", videoId: VIDEO })
      .send({
        type: "unlist-when-ended-toggled",
        videoId: VIDEO,
        checked: false,
      });
    expect(tester.getEffects()).toContainEqual({
      type: "save-unlist-preference",
      videoId: VIDEO,
      checked: false,
    });

    tester.send({
      type: "unlist-preference-read",
      videoId: VIDEO,
      checked: null,
    });
    expect(unlistWhenEndedOf(tester.getState(), VIDEO)).toBe(false);
    expect(unlistWhenEndedOf(tester.getState(), OTHER_VIDEO)).toBe(true);
  });
});

describe("the Unlist When Ended checkbox", () => {
  it("shows beside the picked Broadcast only when it is public", () => {
    expect(
      unlistWhenEndedBesidePick(liveOn("public").getState(), VIDEO)
    ).toEqual({ checked: true });
    expect(
      unlistWhenEndedBesidePick(liveOn("unlisted").getState(), VIDEO)
    ).toBe(null);
    expect(unlistWhenEndedBesidePick(liveOn(null).getState(), VIDEO)).toBe(
      null
    );
    expect(unlistWhenEndedBesidePick(start().getState(), VIDEO)).toBe(null);
  });

  it("shows in the New Broadcast form only when its privacy is Public", () => {
    const form = new ReducerTester(
      newBroadcastReducer,
      createInitialNewBroadcastState({
        id: "video-1",
        title: "Office hours",
        description: null,
        thumbnails: [],
      })
    ).send({ type: "new-broadcast-clicked" });
    expect(showsUnlistWhenEnded(form.getState())).toBe(false);

    form.send({ type: "privacy-picked", privacyStatus: "public" });
    expect(showsUnlistWhenEnded(form.getState())).toBe(true);
  });
});

describe("End Stream and Unlist When Ended", () => {
  it("asks to unlist a public Broadcast with the preference on", () => {
    const tester = liveOn("public").send({
      type: "end-stream-pressed",
      videoId: VIDEO,
    });
    expect(endStreamEffects(tester)).toEqual([
      { type: "end-stream", videoId: VIDEO, unlistWhenEnded: true },
    ]);
  });

  it("doesn't ask when the preference is off for the Video", () => {
    const tester = liveOn("public")
      .send({
        type: "unlist-when-ended-toggled",
        videoId: VIDEO,
        checked: false,
      })
      .send({ type: "end-stream-pressed", videoId: VIDEO });
    expect(endStreamEffects(tester)).toEqual([
      { type: "end-stream", videoId: VIDEO, unlistWhenEnded: false },
    ]);
  });

  it.each(["unlisted", "private", null] as const)(
    "doesn't ask for a %s Broadcast",
    (privacyStatus) => {
      const tester = liveOn(privacyStatus).send({
        type: "end-stream-pressed",
        videoId: VIDEO,
      });
      expect(endStreamEffects(tester)).toEqual([
        { type: "end-stream", videoId: VIDEO, unlistWhenEnded: false },
      ]);
    }
  );

  it("shows a failed unlist until the next press", () => {
    const tester = liveOn("public")
      .send({ type: "end-stream-pressed", videoId: VIDEO })
      .send({
        type: "end-stream-answered",
        unlist: { status: "failed", message: "YouTube answered 403" },
      })
      .send({
        type: "live-stream-heard",
        stream: {
          videoId: VIDEO,
          status: { kind: "ended", reason: "End Stream." },
          liveSince: null,
        },
      });

    expect(goLiveControl(tester.getState(), VIDEO).refusal).toBe(
      "The Broadcast ended, but CVM couldn't make it Unlisted: YouTube answered 403. Make it Unlisted in YouTube Studio."
    );

    tester.send({
      type: "go-live-pressed",
      videoId: VIDEO,
      silenceLength: "short",
    });
    expect(goLiveControl(tester.getState(), VIDEO).refusal).toBe(null);
  });

  it.each([{ status: "unlisted" }, { status: "not-asked" }] as const)(
    "shows nothing when the unlist answered $status",
    (unlist) => {
      const tester = liveOn("public")
        .send({ type: "end-stream-pressed", videoId: VIDEO })
        .send({ type: "end-stream-answered", unlist });
      expect(goLiveControl(tester.getState(), VIDEO).refusal).toBe(null);
    }
  );
});
