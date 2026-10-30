import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { Broadcast } from "./broadcast";
import {
  broadcastPickerRows,
  createInitialLiveStreamState,
  liveStreamReducer,
} from "./live-stream-reducer";

const broadcast = (
  id: string,
  overrides: Partial<Broadcast> = {}
): Broadcast => ({
  id,
  title: `Broadcast ${id}`,
  scheduledStartTime: "2026-10-31T18:00:00Z",
  enableAutoStart: true,
  enableAutoStop: true,
  liveChatId: `chat-${id}`,
  boundStreamId: null,
  ...overrides,
});

const officeHours = broadcast("office-hours");
const qa = broadcast("qa");

const start = () =>
  new ReducerTester(liveStreamReducer, createInitialLiveStreamState());

describe("the Live Stream surface's Broadcast picker", () => {
  it("lists Broadcasts the first time the picker shows, and again only on Refresh", () => {
    const tester = start()
      .send({ type: "broadcast-picker-shown" })
      .send({
        type: "broadcasts-answered",
        answer: { status: "listed", broadcasts: [officeHours] },
      })
      // Matt leaves the Streaming tab and comes back.
      .send({ type: "broadcast-picker-shown" })
      .send({ type: "refresh-broadcasts-clicked" })
      // A second click while the refresh is out asks nothing more.
      .send({ type: "refresh-broadcasts-clicked" })
      .send({
        type: "broadcasts-answered",
        answer: { status: "listed", broadcasts: [officeHours, qa] },
      });

    expect(tester.getEffects()).toEqual([
      { type: "list-broadcasts" },
      { type: "list-broadcasts" },
    ]);
    expect(
      broadcastPickerRows(tester.getState()).map((r) => r.broadcast.id)
    ).toEqual(["office-hours", "qa"]);
  });

  it("keeps the picked Broadcast across a refresh, and drops it once YouTube no longer lists it", () => {
    const tester = start()
      .send({ type: "broadcast-picker-shown" })
      .send({
        type: "broadcasts-answered",
        answer: { status: "listed", broadcasts: [officeHours, qa] },
      })
      .send({ type: "broadcast-clicked", broadcastId: "qa" })
      .send({ type: "refresh-broadcasts-clicked" })
      .send({
        type: "broadcasts-answered",
        answer: {
          status: "listed",
          broadcasts: [officeHours, { ...qa, title: "Q&A, renamed" }],
        },
      });

    expect(tester.getState().pickedBroadcast).toEqual({
      ...qa,
      title: "Q&A, renamed",
    });

    tester.send({ type: "refresh-broadcasts-clicked" }).send({
      type: "broadcasts-answered",
      answer: { status: "listed", broadcasts: [officeHours] },
    });

    expect(tester.getState().pickedBroadcast).toBeNull();
  });

  it("marks a Broadcast YouTube won't auto-start or auto-stop, with the reason, and still lets Matt pick it", () => {
    const manual = broadcast("manual", {
      enableAutoStart: false,
      enableAutoStop: false,
    });
    const state = start()
      .send({ type: "broadcast-picker-shown" })
      .send({
        type: "broadcasts-answered",
        answer: { status: "listed", broadcasts: [officeHours, manual] },
      })
      .send({ type: "broadcast-clicked", broadcastId: "manual" })
      .getState();

    expect(broadcastPickerRows(state)).toEqual([
      { broadcast: officeHours, picked: false, refusal: null },
      {
        broadcast: manual,
        picked: true,
        refusal:
          "Turn on auto-start and auto-stop for this Broadcast in YouTube Studio: CVM never starts or ends a Broadcast itself.",
      },
    ]);
  });

  it("asks for a reconnect instead of an empty picker, and lists again once shown after reconnecting", () => {
    const tester = start()
      .send({ type: "broadcast-picker-shown" })
      .send({
        type: "broadcasts-answered",
        answer: { status: "needs-reconnect", reason: "missing-live-access" },
      });

    expect(tester.getState().broadcastList).toEqual({
      status: "needs-reconnect",
      reason: "missing-live-access",
    });

    tester.send({ type: "broadcast-picker-shown" });
    expect(tester.getEffects()).toEqual([
      { type: "list-broadcasts" },
      { type: "list-broadcasts" },
    ]);
  });

  it("says why a listing failed, and Refresh tries again", () => {
    const tester = start().send({ type: "broadcast-picker-shown" }).send({
      type: "broadcast-listing-failed",
      message: "YouTube answered 500",
    });

    expect(tester.getState().broadcastList).toEqual({
      status: "failed",
      message: "YouTube answered 500",
    });

    tester.send({ type: "refresh-broadcasts-clicked" }).send({
      type: "broadcasts-answered",
      answer: { status: "listed", broadcasts: [qa] },
    });

    expect(tester.getEffects()).toEqual([
      { type: "list-broadcasts" },
      { type: "list-broadcasts" },
    ]);
    expect(
      broadcastPickerRows(tester.getState()).map((r) => r.broadcast.id)
    ).toEqual(["qa"]);
  });
});
