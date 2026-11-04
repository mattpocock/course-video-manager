import { describe, expect, it } from "vitest";
import { chatCardMotion } from "@cvm/core/features/videos/chat-highlight-motion";
import { chatCardInputProps } from "./chat-card-input-props";

// One Chat Card's renderer props, built once for the editor's preview and the
// Short's render alike. All chat is fake.

const card = {
  title: "@fake_viewer_1",
  description: "A fake question?",
  disableEnterAnimation: false,
  disableExitAnimation: true,
};

const frames = { startFrame: 30, durationInFrames: 300, fps: 60 };

describe("chatCardInputProps", () => {
  it("copies the card's content, gives it its motion, and puts it at the top", () => {
    expect(chatCardInputProps(card, frames, [])).toEqual({
      author: "@fake_viewer_1",
      text: "A fake question?",
      startFrame: 30,
      durationInFrames: 300,
      ...chatCardMotion({
        fps: 60,
        durationInFrames: 300,
        disableEnterAnimation: false,
        disableExitAnimation: true,
      }),
      top: 240,
      width: 960,
    });
  });

  it("moves it below the captions when a face is at the top", () => {
    const face = { x: 0, y: 100, w: 1080, h: 900 };
    expect(chatCardInputProps(card, frames, [face])?.top).toBe(1240);
  });

  it("keeps it at the top when the face is just below the card", () => {
    // The card's box at the top slot runs 240 to about 620 (370 px tall plus
    // its 10 px rise).
    const face = { x: 0, y: 625, w: 1080, h: 1000 };
    expect(chatCardInputProps(card, frames, [face])?.top).toBe(240);
  });

  it("gives no props when faces fill both slots", () => {
    const faces = [
      { x: 0, y: 0, w: 1080, h: 700 },
      { x: 0, y: 1300, w: 1080, h: 400 },
    ];
    expect(chatCardInputProps(card, frames, faces)).toBeNull();
  });
});
