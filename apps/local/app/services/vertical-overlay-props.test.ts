import { describe, expect, it } from "vitest";
import { parseOverlayProps } from "@cvm/overlay-renderer/props";
import { CHAT_SPIN_MOTION } from "@cvm/core/features/videos/chat-highlight-motion";
import type { ExportOverlay } from "./export-hash";
import { verticalOverlayProps } from "./vertical-overlay-props";

// The props a Short's render hands its Remotion composition. All chat is fake.

const overlay = (overrides: Partial<ExportOverlay> = {}): ExportOverlay => ({
  at: 2,
  durationInSeconds: 5,
  kind: "chatCard",
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "@fake_viewer_1",
  description: "A fake question?",
  bullets: null,
  chatSpin: [
    { author: "@fake_viewer_2", text: "Fake message two" },
    { author: "@fake_viewer_3", text: "Fake message three" },
  ],
  ...overrides,
});

const props = (overlays: ExportOverlay[][]) =>
  verticalOverlayProps({
    fps: 60,
    durationInFrames: 1200,
    subtitles: [],
    clips: overlays.map((o) => ({ overlays: o })),
    clipDurations: overlays.map(() => ({ duration: 10, pauseType: "none" })),
  });

describe("a Short's render props", () => {
  it("pass a Chat Card with its frames, placement and spin cells", () => {
    const [card, ...rest] = props([[], [overlay()]]).chatCards;

    expect(rest).toEqual([]);
    expect(card).toMatchObject({
      author: "@fake_viewer_1",
      text: "A fake question?",
      cells: overlay().chatSpin,
      // Its Clip starts 10s in, and it 2s into that.
      startFrame: 720,
      durationInFrames: 300,
      top: 240,
      width: 960,
    });
    expect(card!.enter).toHaveLength((CHAT_SPIN_MOTION.ms * 60) / 1000);
    expect(card!.enter.at(-1)!.scroll).toBeCloseTo(2, 2);
    expect(card!.exit.length).toBeGreaterThan(0);
    // The renderer accepts them as they are.
    expect(() => parseOverlayProps(props([[overlay()]]))).not.toThrow();
  });

  it("draw no other Overlay Kind", () => {
    expect(
      props([[overlay({ kind: "definitionCard", chatSpin: null })]]).chatCards
    ).toEqual([]);
  });

  it("draw no call to action: captions, and nothing else, for a Short with no Chat Card", () => {
    expect(props([[]])).toEqual({
      width: 1080,
      height: 1920,
      fps: 60,
      durationInFrames: 1200,
      subtitles: [],
      cta: null,
      chatCards: [],
    });
  });
});
