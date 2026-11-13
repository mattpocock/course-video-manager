import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialWriterChatState,
  selectWriterChatNotice,
  writerChatReducer,
} from "./writer-chat-reducer";

const chat = () =>
  new ReducerTester(
    writerChatReducer,
    createInitialWriterChatState({
      videoId: "video-1",
      fieldId: "video-body",
      mode: "article",
    })
  );

const save = (mode: string, messages: unknown[]) => ({
  type: "save-writer-chat",
  videoId: "video-1",
  fieldId: "video-body",
  mode,
  messages,
});

describe("writerChatReducer", () => {
  it("shows each mode's saved Writer Chat, saves each settled turn, and says so when a save fails until Retry saves it", () => {
    const tester = chat().send({
      type: "writer-chats-loaded",
      chats: { article: ["a1"], problem: ["p1"] },
    });

    expect(selectWriterChatNotice(tester.getState())).toBeNull();

    const settled = ["a1", "a2"];
    tester
      .send({ type: "turn-settled", mode: "article", messages: settled })
      .send({
        type: "writer-chat-save-failed",
        mode: "article",
        messages: settled,
        message: "The server answered 500",
      });

    expect(selectWriterChatNotice(tester.getState())).toEqual({
      kind: "save-failed",
      message: "The server answered 500",
    });

    tester
      .send({ type: "save-retry-clicked" })
      .send({ type: "writer-chat-saved" })
      .send({ type: "mode-picked", mode: "problem", messages: settled });

    expect(selectWriterChatNotice(tester.getState())).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "show-messages", messages: ["a1"] },
      save("article", settled),
      save("article", settled),
      // Leaving a mode whose chat is already saved saves nothing more.
      { type: "show-messages", messages: ["p1"] },
    ]);
  });
});
