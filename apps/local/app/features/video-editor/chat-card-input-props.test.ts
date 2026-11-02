import { describe, expect, it } from "vitest";
import { CHAT_CARD_PLACEMENT } from "@cvm/overlay-renderer/props";
import { chatCardMotion } from "@cvm/core/features/videos/chat-highlight-motion";
import { chatCardInputProps } from "./chat-card-input-props";

// One Chat Card's renderer props, built once for the editor's preview and the
// Short's render alike. All chat is fake.

const cells = [
  { author: "@fake_viewer_2", text: "Fake message two" },
  { author: "@fake_viewer_3", text: "Fake message three" },
];

const card = {
  title: "@fake_viewer_1",
  description: "A fake question?",
  chatSpin: cells,
  disableEnterAnimation: false,
  disableExitAnimation: true,
};

describe("chatCardInputProps", () => {
  it("copies the card's content, places it, and gives it its motion", () => {
    expect(
      chatCardInputProps(card, {
        startFrame: 30,
        durationInFrames: 300,
        fps: 60,
      })
    ).toEqual({
      author: "@fake_viewer_1",
      text: "A fake question?",
      cells,
      startFrame: 30,
      durationInFrames: 300,
      ...chatCardMotion({
        cellCount: 3,
        fps: 60,
        durationInFrames: 300,
        disableEnterAnimation: false,
        disableExitAnimation: true,
      }),
      ...CHAT_CARD_PLACEMENT,
    });
  });

  it("gives a card with no spin cells an empty reel", () => {
    const props = chatCardInputProps(
      { ...card, chatSpin: null },
      { startFrame: 0, durationInFrames: 120, fps: 60 }
    );
    expect(props.cells).toEqual([]);
    expect(props.enter.every((pose) => pose.scroll === 0)).toBe(true);
  });
});
