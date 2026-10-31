import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { ChatMessage } from "./broadcast-chat";
import { chatRows, GO_LIVE_FIRST } from "./chat-highlight-reducer";
import {
  createInitialLiveStreamState,
  liveStreamReducer,
} from "./live-stream-reducer";

const VIDEO = "video-1";

const message = (id: string): ChatMessage => ({
  id,
  author: `@fake_${id}`,
  text: `Fake question ${id}`,
  publishedAt: "2026-10-31T18:00:00Z",
});

/** The picked Broadcast's chat, with three fake messages. */
const withChat = () =>
  new ReducerTester(liveStreamReducer, createInitialLiveStreamState()).send({
    type: "chat-attached",
    chat: {
      broadcastId: "office-hours",
      connection: { state: "streaming" },
      messages: [message("m1"), message("m2"), message("m3")],
    },
  });

const live = () =>
  withChat().send({
    type: "live-stream-heard",
    stream: { videoId: VIDEO, status: { kind: "live" } },
  });

const click = (messageId: string) =>
  ({ type: "chat-message-clicked", videoId: VIDEO, messageId }) as const;

/** The messages on the picture, as the chat shows them. */
const highlighted = (tester: ReturnType<typeof live>) =>
  chatRows(tester.getState())
    .filter((r) => r.highlighted)
    .map((r) => r.id);

describe("the Chat Highlight: one message on the stream picture at a time", () => {
  it("shows a clicked message, hides it on a second click, and replaces it when another is clicked", () => {
    const tester = live()
      .send(click("m1"))
      // A second click while the first is out does nothing.
      .send(click("m2"))
      .send({
        type: "chat-highlight-shown",
        messageId: "m1",
        highlightId: "h1",
      });
    expect(highlighted(tester)).toEqual(["m1"]);

    tester
      .send(click("m1"))
      .send({ type: "chat-highlight-hidden", highlightId: "h1" });
    expect(highlighted(tester)).toEqual([]);

    tester
      .send(click("m2"))
      .send({
        type: "chat-highlight-shown",
        messageId: "m2",
        highlightId: "h2",
      })
      // Another message replaces it: the recorder swaps the cards.
      .send(click("m3"))
      .send({
        type: "chat-highlight-shown",
        messageId: "m3",
        highlightId: "h3",
      });
    expect(highlighted(tester)).toEqual(["m3"]);

    expect(tester.getEffects()).toEqual([
      { type: "show-highlight", videoId: VIDEO, messageId: "m1" },
      { type: "hide-highlight", videoId: VIDEO, highlightId: "h1" },
      { type: "show-highlight", videoId: VIDEO, messageId: "m2" },
      { type: "show-highlight", videoId: VIDEO, messageId: "m3" },
    ]);
  });

  it("says why a click before Go Live shows nothing, and a refused click why it was refused, leaving what shows", () => {
    const before = withChat().send(click("m1"));
    expect(before.getEffects()).toEqual([]);
    expect(before.getState().highlight.error).toBe(GO_LIVE_FIRST);

    const tester = live()
      .send(click("m1"))
      .send({
        type: "chat-highlight-shown",
        messageId: "m1",
        highlightId: "h1",
      })
      .send(click("m2"))
      .send({
        type: "chat-highlight-failed",
        message: "That message is no longer in the Broadcast's chat.",
      });
    expect(highlighted(tester)).toEqual(["m1"]);
    expect(tester.getState().highlight.error).toBe(
      "That message is no longer in the Broadcast's chat."
    );
    // The next click is taken.
    tester.send(click("m1"));
    expect(tester.getEffects().at(-1)).toEqual({
      type: "hide-highlight",
      videoId: VIDEO,
      highlightId: "h1",
    });
  });

  it("drops the Chat Highlight when the Live Stream ends, as the recorder closed it", () => {
    const tester = live()
      .send(click("m1"))
      .send({
        type: "chat-highlight-shown",
        messageId: "m1",
        highlightId: "h1",
      })
      .send({
        type: "live-stream-heard",
        stream: {
          videoId: VIDEO,
          status: { kind: "ended", reason: "End Stream." },
        },
      });
    expect(highlighted(tester)).toEqual([]);
  });
});
