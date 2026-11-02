import { describe, expect, it } from "vitest";
import { AUTHOR_COLORS, authorColor, rowAge, rowBadge } from "./chat-presenter";

const row = (highlighted: boolean, pending: boolean) => ({
  id: "m1",
  author: "@a",
  text: "hi",
  highlighted,
  pending,
});

describe("the pop-out chat as a presenter reads it", () => {
  it("gives an author the same colour every time, from the palette", () => {
    expect(authorColor("@viewer-one")).toBe(authorColor("@viewer-one"));
    expect(AUTHOR_COLORS).toContain(authorColor("@viewer-one"));
    expect(AUTHOR_COLORS).toContain(authorColor("🎉 emoji name"));
    expect(AUTHOR_COLORS).toContain(authorColor(""));
  });

  it("spreads different authors over the palette", () => {
    const names = Array.from({ length: 50 }, (_, i) => `@viewer-${i}`);
    expect(new Set(names.map(authorColor)).size).toBeGreaterThan(5);
  });

  it("marks the message on the stream, and the one whose click is out", () => {
    expect(rowBadge(row(false, false))).toBe(null);
    expect(rowBadge(row(true, false))).toBe("on-stream");
    expect(rowBadge(row(false, true))).toBe("showing");
    expect(rowBadge(row(true, true))).toBe("hiding");
  });

  it("steps rows back from the newest", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => rowAge(i, 6))).toEqual([
      3, 3, 3, 2, 1, 0,
    ]);
    expect(rowAge(0, 1)).toBe(0);
  });
});
