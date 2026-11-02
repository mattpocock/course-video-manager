import { describe, expect, it } from "vitest";
import {
  CHAT_SPIN_MOTION,
  chatCardMotion,
  chatSpinPose,
} from "./chat-highlight-motion.js";
import {
  chatHighlightAt,
  chatSpinReel,
  type ChatCardSource,
} from "./chat-card.js";

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

describe("the Chat Spin's pose", () => {
  it.each([
    // ms, cells, scroll, opacity
    [0, 5, 0, 0],
    [CHAT_SPIN_MOTION.ms, 5, 4, 1],
    [CHAT_SPIN_MOTION.ms * 2, 5, 4, 1],
    [CHAT_SPIN_MOTION.ms, 9, 8, 1],
    [600, 1, 0, 1],
  ])(
    "at %sms of %s cells scrolls %s and is %s opaque",
    (ms, cells, scroll, opacity) => {
      const pose = chatSpinPose(ms, cells);
      expect(pose.scroll).toBeCloseTo(scroll, 6);
      expect(pose.opacity).toBeCloseTo(opacity, 6);
    }
  );

  it("scrolls forward every frame and never past the pick", () => {
    const scrolls = Array.from(
      { length: 73 },
      (_, frame) => chatSpinPose((frame * 1000) / 60, 9).scroll
    );
    for (let i = 1; i < scrolls.length; i++) {
      expect(scrolls[i]!).toBeGreaterThanOrEqual(scrolls[i - 1]!);
      expect(scrolls[i]!).toBeLessThanOrEqual(8);
    }
  });

  it("is an ease-out: most of the reel goes by in the first half", () => {
    expect(chatSpinPose(CHAT_SPIN_MOTION.ms / 2, 9).scroll).toBeGreaterThan(6);
  });
});

describe("a Chat Card's motion", () => {
  const motion = (o: Partial<Parameters<typeof chatCardMotion>[0]> = {}) =>
    chatCardMotion({
      cellCount: 5,
      fps: 60,
      durationInFrames: 600,
      disableEnterAnimation: false,
      disableExitAnimation: false,
      ...o,
    });

  it.each([
    // what, options, intro frames, exit frames
    ["a spin", {}, 72, 9],
    ["one cell: the card's own entrance", { cellCount: 1 }, 15, 9],
    [
      "no enter animation: a hard cut in",
      { disableEnterAnimation: true },
      0,
      9,
    ],
    [
      "no exit animation: a hard cut out",
      { disableExitAnimation: true },
      72,
      0,
    ],
    [
      "too short for both: the intro cut short",
      { durationInFrames: 30 },
      21,
      9,
    ],
  ])("%s", (_, options, enterFrames, exitFrames) => {
    const { enter, exit } = motion(options);
    expect(enter).toHaveLength(enterFrames);
    expect(exit).toHaveLength(exitFrames);
  });

  it("lands on the pick, settled, and leaves from there", () => {
    const { enter, exit } = motion();
    expect(enter[0]).toMatchObject({ scroll: 0, opacity: 0 });
    expect(enter.at(-1)!.scroll).toBeCloseTo(4, 2);
    expect(enter.at(-1)!.opacity).toBe(1);
    expect(exit.every((pose) => pose.scroll === 4)).toBe(true);
    expect(exit.at(-1)!.opacity).toBeCloseTo(0, 6);
  });
});

describe("the Chat Highlight a Chat Card defaults to", () => {
  const session = [highlight(1, 1000, 2000), highlight(2, 5000, null)];

  it.each([
    ["the one showing", 1500, "h1"],
    ["the last shown before, once it is hidden", 3000, "h1"],
    ["one still showing", 9000, "h2"],
    ["none, before the first", 500, undefined],
  ])("is %s", (_, atMs, id) => {
    expect(chatHighlightAt(session, atMs)?.id).toBe(id);
  });
});

describe("the Chat Spin's reel", () => {
  it("is the session's other Highlights in shown order, without the pick", () => {
    const pick = highlight(2, 2000);
    const reel = chatSpinReel(pick, [
      highlight(3, 3000),
      pick,
      highlight(1, 1000),
    ]);
    expect(reel).toEqual([
      { author: "@fake_viewer_1", text: "Fake question 1" },
      { author: "@fake_viewer_3", text: "Fake question 3" },
    ]);
  });

  it("is empty with fewer than two others", () => {
    const pick = highlight(1, 1000);
    expect(chatSpinReel(pick, [pick, highlight(2, 2000)])).toEqual([]);
  });

  it("keeps the eight nearest the pick", () => {
    const all = Array.from({ length: 12 }, (_, i) => highlight(i, i * 1000));
    const reel = chatSpinReel(all[0]!, all);
    expect(reel.map((c) => c.author)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `@fake_viewer_${n}`)
    );
  });
});
