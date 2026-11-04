import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialStreamChatPopoutState,
  streamChatPopoutReducer,
} from "./stream-chat-popout-reducer";
import type { ChatView } from "./chat-view";

const view: ChatView = {
  line: null,
  notices: [],
  waiting: false,
  viewers: null,
  liveSince: null,
  rows: [
    {
      id: "m1",
      author: "@a",
      text: "hi",
      highlighted: false,
      pending: false,
    },
  ],
};

const popout = () =>
  new ReducerTester(
    streamChatPopoutReducer,
    createInitialStreamChatPopoutState()
  );

describe("the pop-out chat window", () => {
  it("shows nothing until the Streaming tab sends its chat", () => {
    expect(popout().getState()).toEqual({
      view: null,
      attached: false,
      heardAt: 0,
    });
  });

  it("draws the chat the Streaming tab sent", () => {
    const t = popout().send({ type: "chat-view-heard", view, at: 1_000 });
    expect(t.getState()).toMatchObject({ view, attached: true });
  });

  it("says the Streaming tab is gone once it stops answering, and keeps the last chat", () => {
    const t = popout()
      .send({ type: "chat-view-heard", view, at: 1_000 })
      .send({ type: "ticked", at: 4_000 });
    expect(t.getState().attached).toBe(true);

    t.send({ type: "ticked", at: 7_000 });
    expect(t.getState()).toMatchObject({ view, attached: false });

    t.send({ type: "chat-view-heard", view, at: 7_500 });
    expect(t.getState().attached).toBe(true);
  });
});
