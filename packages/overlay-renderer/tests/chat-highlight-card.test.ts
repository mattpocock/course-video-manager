import { describe, expect, it } from "vitest";
import {
  CHAT_HIGHLIGHT_AUTHOR_TYPE,
  CHAT_HIGHLIGHT_MESSAGE_TYPE,
  chatHighlightCanvasSize,
} from "../src/chat-highlight-card";
import { BODY_TYPE } from "../src/definition-card-tokens";

describe("the Chat Highlight card (#2558: slightly larger)", () => {
  it("draws its type a quarter larger than the Definition Card's body", () => {
    expect(CHAT_HIGHLIGHT_MESSAGE_TYPE.fontSize).toBe(32.5);
    expect(CHAT_HIGHLIGHT_AUTHOR_TYPE.fontSize).toBe(32.5);
    expect(BODY_TYPE.fontSize).toBe(26);
  });

  it("sizes the stream's still at 1920 as the recorder service expects (CARD_CANVAS)", () => {
    expect(chatHighlightCanvasSize(1920)).toEqual({ width: 896, height: 406 });
  });
});
