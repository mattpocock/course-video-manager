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

const props = (
  overlays: ExportOverlay[][],
  pauseType: "none" | "long" = "none"
) =>
  verticalOverlayProps({
    fps: 60,
    durationInFrames: 1200,
    subtitles: [],
    clips: overlays.map((o) => ({ overlays: o })),
    clipDurations: overlays.map(() => ({ duration: 10, pauseType })),
  });

const callToAction = (overrides: Partial<ExportOverlay> = {}) =>
  overlay({
    kind: "callToAction",
    title: "example.com",
    description: "A fake subline",
    chatSpin: null,
    ...overrides,
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

  it("place a Call to Action anchored mid-Clip on its frames, words as written", () => {
    expect(props([[], [callToAction()]]).callsToAction).toEqual([
      {
        title: "example.com",
        description: "A fake subline",
        // Its Clip starts 10s in, and it 2s into that, for 5s.
        startFrame: 720,
        durationInFrames: 300,
        disableEnterAnimation: false,
        disableExitAnimation: false,
      },
    ]);
    expect(() => parseOverlayProps(props([[callToAction()]]))).not.toThrow();
  });

  it("run a Call to Action on across the Clips after its own", () => {
    const [card] = props([
      [callToAction({ at: 8, durationInSeconds: 7 })],
      [],
    ]).callsToAction;
    expect(card).toMatchObject({ startFrame: 480, durationInFrames: 420 });
  });

  it("place a Call to Action after a long Pause past the Pause", () => {
    // Each 10s Clip is followed by a 0.18s long Pause.
    const [card] = props([[], [callToAction({ at: 0 })]], "long").callsToAction;
    expect(card).toMatchObject({ startFrame: Math.round(10.18 * 60) });
  });

  it("pass a Call to Action's Animation Toggles through", () => {
    const [card] = props([
      [
        callToAction({
          disableEnterAnimation: true,
          disableExitAnimation: true,
        }),
      ],
    ]).callsToAction;
    expect(card).toMatchObject({
      disableEnterAnimation: true,
      disableExitAnimation: true,
    });
  });

  it("send both a Call to Action and a Chat Card on screen at the same moment", () => {
    const sent = props([[overlay(), callToAction()]]);

    expect([sent.chatCards, sent.callsToAction]).toMatchObject([
      [{ author: "@fake_viewer_1", startFrame: 120, durationInFrames: 300 }],
      [{ title: "example.com", startFrame: 120, durationInFrames: 300 }],
    ]);
  });

  it("send no Call to Action, and nothing but captions, for a Short with no Overlays", () => {
    expect(props([[]])).toEqual({
      width: 1080,
      height: 1920,
      fps: 60,
      durationInFrames: 1200,
      subtitles: [],
      chatCards: [],
      callsToAction: [],
    });
  });
});
