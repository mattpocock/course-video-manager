import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialLiveStreamState,
  liveStreamReducer,
} from "./live-stream-reducer";
import { chatView } from "./chat-view";
import { highlightOnPicture } from "./chat-highlight-reducer";

const message = (id: string, text: string) => ({
  id,
  author: `@viewer-${id}`,
  text,
  publishedAt: "2026-11-02T18:00:00Z",
});

const live = () =>
  new ReducerTester(liveStreamReducer, createInitialLiveStreamState())
    .send({
      type: "live-stream-heard",
      stream: { videoId: "v1", status: { kind: "live" } },
    })
    .send({
      type: "chat-attached",
      chat: {
        broadcastId: "b1",
        connection: { state: "streaming" },
        messages: [message("m1", "first"), message("m2", "second")],
      },
    });

describe("the chat view, on the Streaming tab and in its pop-out", () => {
  it("lists the messages, marking the one on the stream and the one whose click is out", () => {
    const t = live()
      .send({ type: "chat-message-clicked", videoId: "v1", messageId: "m1" })
      .send({
        type: "chat-highlight-shown",
        messageId: "m1",
        highlightId: "h1",
      })
      .send({ type: "chat-message-clicked", videoId: "v1", messageId: "m2" });

    expect(chatView(t.getState(), null).rows).toEqual([
      {
        id: "m1",
        author: "@viewer-m1",
        text: "first",
        highlighted: true,
        pending: false,
      },
      {
        id: "m2",
        author: "@viewer-m2",
        text: "second",
        highlighted: false,
        pending: true,
      },
    ]);
  });

  it("says why nothing shows before a Broadcast is picked, and why highlights can't show", () => {
    const view = chatView(
      createInitialLiveStreamState(),
      "The card's browser is not downloaded."
    );
    expect(view).toEqual({
      line: { text: "Pick a Broadcast to see its live chat.", warn: false },
      notices: ["The card's browser is not downloaded."],
      waiting: false,
      rows: [],
    });
  });

  it("says no messages yet only while the chat streams with none", () => {
    const t = new ReducerTester(
      liveStreamReducer,
      createInitialLiveStreamState()
    ).send({
      type: "chat-attached",
      chat: {
        broadcastId: "b1",
        connection: { state: "streaming" },
        messages: [],
      },
    });
    expect(chatView(t.getState(), null)).toMatchObject({
      line: null,
      waiting: true,
    });
  });

  it("carries a refused click's reason as a notice", () => {
    const t = new ReducerTester(
      liveStreamReducer,
      createInitialLiveStreamState()
    ).send({ type: "chat-message-clicked", videoId: "v1", messageId: "m1" });
    expect(chatView(t.getState(), null).notices).toEqual([
      "Go Live first: a Chat Highlight shows on the Live Stream picture.",
    ]);
  });

  describe("a chat connection that drops (#2558)", () => {
    const reconnecting = {
      type: "chat-connection-changed",
      broadcastId: "b1",
      connection: { state: "reconnecting", message: "terminated" },
    } as const;
    const streaming = {
      type: "chat-connection-changed",
      broadcastId: "b1",
      connection: { state: "streaming" },
    } as const;

    it("says nothing of a reconnect that is over within the grace", () => {
      const t = live().send(reconnecting);
      expect(chatView(t.getState(), null).line).toBeNull();
      expect(t.getEffects()).toEqual([
        { type: "await-reconnect-grace", broadcastId: "b1", reconnect: 1 },
      ]);

      t.send(streaming).send({
        type: "chat-reconnect-grace-ended",
        broadcastId: "b1",
        reconnect: 1,
      });
      expect(chatView(t.getState(), null).line).toBeNull();
    });

    it("says it is reconnecting once a reconnect outlasts the grace", () => {
      const t = live().send(reconnecting).send({
        type: "chat-reconnect-grace-ended",
        broadcastId: "b1",
        reconnect: 1,
      });
      expect(chatView(t.getState(), null).line).toEqual({
        text: "Chat connection dropped, reconnecting: terminated",
        warn: true,
      });
    });

    it("gives each reconnect its own grace, so an earlier one's never shows a later one early", () => {
      const t = live()
        .send(reconnecting)
        .send(streaming)
        .send(reconnecting)
        .send({
          type: "chat-reconnect-grace-ended",
          broadcastId: "b1",
          reconnect: 1,
        });
      expect(chatView(t.getState(), null).line).toBeNull();
    });

    it("words polling as how chat arrives, not as a disconnect", () => {
      const t = live().send({
        type: "chat-connection-changed",
        broadcastId: "b1",
        connection: { state: "polling" },
      });
      expect(chatView(t.getState(), null).line).toEqual({
        text: "Chat is being polled while YouTube's streaming connection is down. Messages still arrive.",
        warn: false,
      });
    });
  });

  it("puts the message on the Streaming tab's picture once the stream shows it, and takes it off once hidden", () => {
    const t = live().send({
      type: "chat-message-clicked",
      videoId: "v1",
      messageId: "m2",
    });
    expect(highlightOnPicture(t.getState())).toBeNull();

    t.send({
      type: "chat-highlight-shown",
      messageId: "m2",
      highlightId: "h1",
    });
    expect(highlightOnPicture(t.getState())).toEqual({
      author: "@viewer-m2",
      text: "second",
    });

    t.send({
      type: "chat-message-clicked",
      videoId: "v1",
      messageId: "m2",
    }).send({ type: "chat-highlight-hidden", highlightId: "h1" });
    expect(highlightOnPicture(t.getState())).toBeNull();
  });
});
