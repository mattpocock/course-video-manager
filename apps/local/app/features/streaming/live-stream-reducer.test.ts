import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { Broadcast } from "./broadcast";
import type { ChatMessage } from "./broadcast-chat";
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

const fakeMessage = (n: number): ChatMessage => ({
  id: `msg-${n}`,
  author: `@fake_viewer_${n}`,
  text: `Fake question number ${n}`,
  publishedAt: "2026-10-30T18:00:00Z",
});

const listed = (...broadcasts: Broadcast[]) =>
  start()
    .send({ type: "broadcast-picker-shown" })
    .send({
      type: "broadcasts-answered",
      answer: { status: "listed", broadcasts },
    });

describe("the Live Stream surface's chat buffer", () => {
  it("picking a Broadcast hands its chat to the app server, and its messages fill the buffer as they arrive", () => {
    const tester = listed(officeHours, qa)
      .send({ type: "broadcast-clicked", broadcastId: "office-hours" })
      // Clicking it again changes nothing.
      .send({ type: "broadcast-clicked", broadcastId: "office-hours" })
      .send({
        type: "chat-connection-changed",
        broadcastId: "office-hours",
        connection: { state: "streaming" },
      })
      .send({
        type: "chat-message-received",
        broadcastId: "office-hours",
        messages: [fakeMessage(1)],
      })
      .send({
        type: "chat-message-received",
        broadcastId: "office-hours",
        messages: [fakeMessage(2), fakeMessage(3)],
      });

    expect(tester.getEffects()).toEqual([
      { type: "list-broadcasts" },
      {
        type: "pick-broadcast",
        pick: { broadcastId: "office-hours", liveChatId: "chat-office-hours" },
      },
    ]);
    expect(tester.getState().chat).toEqual({
      broadcastId: "office-hours",
      connection: { state: "streaming" },
      messages: [fakeMessage(1), fakeMessage(2), fakeMessage(3)],
    });
  });

  it("picking another Broadcast switches chat, and a late message from the old one is dropped", () => {
    const tester = listed(officeHours, qa)
      .send({ type: "broadcast-clicked", broadcastId: "office-hours" })
      .send({
        type: "chat-message-received",
        broadcastId: "office-hours",
        messages: [fakeMessage(1)],
      })
      .send({ type: "broadcast-clicked", broadcastId: "qa" })
      .send({
        type: "chat-message-received",
        broadcastId: "office-hours",
        messages: [fakeMessage(2)],
      });

    expect(tester.getEffects().at(-1)).toEqual({
      type: "pick-broadcast",
      pick: { broadcastId: "qa", liveChatId: "chat-qa" },
    });
    expect(tester.getState().chat).toEqual({
      broadcastId: "qa",
      connection: { state: "connecting" },
      messages: [],
    });
  });

  it("after a reload, re-attaches to the chat the app server kept, and re-picks its Broadcast without asking again", () => {
    const tester = start()
      .send({
        type: "chat-attached",
        chat: {
          broadcastId: "qa",
          connection: { state: "streaming" },
          messages: [fakeMessage(1), fakeMessage(2)],
        },
      })
      .send({ type: "broadcast-picker-shown" })
      .send({
        type: "broadcasts-answered",
        answer: { status: "listed", broadcasts: [officeHours, qa] },
      })
      .send({ type: "broadcast-clicked", broadcastId: "qa" });

    expect(tester.getState().pickedBroadcast).toEqual(qa);
    expect(tester.getState().chat.messages).toEqual([
      fakeMessage(1),
      fakeMessage(2),
    ]);
    expect(tester.getEffects()).toEqual([{ type: "list-broadcasts" }]);
  });

  it("End Stream's empty chat clears the buffer", () => {
    const tester = listed(officeHours)
      .send({ type: "broadcast-clicked", broadcastId: "office-hours" })
      .send({
        type: "chat-message-received",
        broadcastId: "office-hours",
        messages: [fakeMessage(1)],
      })
      .send({
        type: "chat-attached",
        chat: {
          broadcastId: null,
          connection: { state: "idle" },
          messages: [],
        },
      });

    expect(tester.getState().chat).toEqual({
      broadcastId: null,
      connection: { state: "idle" },
      messages: [],
    });
  });
});
