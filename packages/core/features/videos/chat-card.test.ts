import { describe, expect, it } from "vitest";
import { chatCardMotion } from "./chat-highlight-motion.js";
import { chatHighlightAt, type ChatCardSource } from "./chat-card.js";

const highlight = (
  n: number,
  shownAtMs: number,
  hiddenAtMs: number | null = shownAtMs + 1000
): ChatCardSource => ({
  id: `h${n}`,
  author: `@fake_viewer_${n}`,
  text: `Fake question ${n}`,
  shownAtMs,
  hiddenAtMs,
});

describe("a Chat Card's motion", () => {
  const motion = (o: Partial<Parameters<typeof chatCardMotion>[0]> = {}) =>
    chatCardMotion({
      fps: 60,
      durationInFrames: 600,
      disableEnterAnimation: false,
      disableExitAnimation: false,
      ...o,
    });

  it.each([
    // what, options, enter frames, exit frames
    ["a fade in of 200 ms and out of 150 ms", {}, 12, 9],
    [
      "no enter animation: a hard cut in",
      { disableEnterAnimation: true },
      0,
      9,
    ],
    [
      "no exit animation: a hard cut out",
      { disableExitAnimation: true },
      12,
      0,
    ],
    [
      "too short for both: the entrance cut short",
      { durationInFrames: 15 },
      6,
      9,
    ],
  ])("%s", (_, options, enterFrames, exitFrames) => {
    const { enter, exit } = motion(options);
    expect(enter).toHaveLength(enterFrames);
    expect(exit).toHaveLength(exitFrames);
  });

  it("is very subtle: a fade, rising at most 10 px, never overshooting", () => {
    const { enter, exit } = motion();
    expect(enter[0]).toEqual({ opacity: 0, offsetY: 10 });
    for (const pose of [...enter, ...exit]) {
      expect(pose.opacity).toBeGreaterThanOrEqual(0);
      expect(pose.opacity).toBeLessThanOrEqual(1);
      expect(pose.offsetY).toBeGreaterThanOrEqual(0);
      expect(pose.offsetY).toBeLessThanOrEqual(10);
    }
    for (let i = 1; i < enter.length; i++) {
      expect(enter[i]!.opacity).toBeGreaterThan(enter[i - 1]!.opacity);
      expect(enter[i]!.offsetY).toBeLessThan(enter[i - 1]!.offsetY);
    }
    // It leaves where it sits, fading out.
    expect(exit.every((pose) => pose.offsetY === 0)).toBe(true);
    expect(exit.at(-1)!.opacity).toBeCloseTo(0, 6);
  });
});

describe("the Chat Highlight a Chat Card defaults to", () => {
  const session = [highlight(1, 1000, 2000), highlight(2, 5000, null)];

  it.each([
    ["the one showing", 1500, "h1"],
    ["none, once the last shown is hidden", 3000, undefined],
    ["one still showing", 9000, "h2"],
    ["none, before the first", 500, undefined],
  ])("is %s", (_, atMs, id) => {
    expect(chatHighlightAt(session, atMs)?.id).toBe(id);
  });

  // h1 was replaced by h2 without a hide edge, so it stays open; h2 is hidden.
  const replaced = [highlight(1, 1000, null), highlight(2, 5000, 8000)];

  it.each([
    ["the later one, over one never hidden", 6000, "h2"],
    ["none, once the later one is hidden", 9000, undefined],
  ])("is %s", (_, atMs, id) => {
    expect(chatHighlightAt(replaced, atMs)?.id).toBe(id);
  });
});
