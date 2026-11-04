import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { StreamChatToParent } from "@/lib/stream-chat-protocol";
import {
  createInitialLiveStreamState,
  liveStreamReducer,
} from "./live-stream-reducer";
import { chatView } from "./chat-view";
import { GO_LIVE_FIRST } from "./chat-highlight-reducer";
import { streamChatBridgeStep } from "./stream-chat-bridge";

const message = (id: string) => ({
  id,
  author: `@viewer-${id}`,
  text: `message ${id}`,
  publishedAt: "2026-11-02T18:00:00Z",
});

const withChat = () =>
  new ReducerTester(liveStreamReducer, createInitialLiveStreamState()).send({
    type: "chat-attached",
    chat: {
      broadcastId: "b1",
      connection: { state: "streaming" },
      messages: [message("m1"), message("m2")],
    },
  });

const live = () =>
  withChat().send({
    type: "live-stream-heard",
    stream: { videoId: "v1", status: { kind: "live" }, liveSince: null },
  });

/** A click in the pop-out, as it crosses the BroadcastChannel to the tab. */
const popoutClick = (t: ReturnType<typeof withChat>, messageId: string) => {
  const wire = StreamChatToParent.parse(
    JSON.parse(JSON.stringify({ type: "chat-message-clicked", messageId }))
  );
  const step = streamChatBridgeStep(wire, "v1");
  if (step.type !== "dispatch") throw new Error("expected a dispatch");
  return t.send(step.action);
};

const rowsOf = (t: ReturnType<typeof withChat>) =>
  chatView(t.getState(), null).rows.map(({ id, highlighted, pending }) => ({
    id,
    highlighted,
    pending,
  }));

describe("a click in the chat pop-out, on the Streaming tab", () => {
  it("answers a ping with the chat", () => {
    expect(streamChatBridgeStep({ type: "ping" }, "v1")).toEqual({
      type: "send-chat-view",
    });
  });

  it("shows the clicked message on the stream", () => {
    const t = popoutClick(live(), "m2");
    expect(t.getEffects()).toEqual([
      { type: "show-highlight", videoId: "v1", messageId: "m2" },
    ]);
    expect(rowsOf(t)).toEqual([
      { id: "m1", highlighted: false, pending: false },
      { id: "m2", highlighted: false, pending: true },
    ]);

    t.send({
      type: "chat-highlight-shown",
      messageId: "m2",
      highlightId: "h1",
    });
    expect(rowsOf(t)).toEqual([
      { id: "m1", highlighted: false, pending: false },
      { id: "m2", highlighted: true, pending: false },
    ]);
  });

  it("hides the shown message when it is clicked again", () => {
    const t = popoutClick(live(), "m2").send({
      type: "chat-highlight-shown",
      messageId: "m2",
      highlightId: "h1",
    });
    t.resetExec();

    popoutClick(t, "m2");
    expect(t.getEffects()).toEqual([
      { type: "hide-highlight", videoId: "v1", highlightId: "h1" },
    ]);
    t.send({ type: "chat-highlight-hidden", highlightId: "h1" });
    expect(rowsOf(t).every((r) => !r.highlighted)).toBe(true);
  });

  it("says why nothing shows before Go Live", () => {
    const t = popoutClick(withChat(), "m1");
    expect(t.getEffects()).toEqual([]);
    expect(chatView(t.getState(), null).notices).toEqual([GO_LIVE_FIRST]);
  });
});
