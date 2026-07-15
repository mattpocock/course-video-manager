import { describe, it, expect } from "vitest";
import {
  findConvertibleAiHeroUrls,
  hasAiHeroUrls,
  replaceUrls,
} from "./convert-short-links";

describe("findConvertibleAiHeroUrls", () => {
  it("finds aihero.dev URLs in text", () => {
    const text = "Check out https://aihero.dev/skills/subscribe for more info.";
    expect(findConvertibleAiHeroUrls(text)).toEqual([
      "https://aihero.dev/skills/subscribe",
    ]);
  });

  it("returns empty array when no aihero.dev URLs exist", () => {
    expect(findConvertibleAiHeroUrls("No links here")).toEqual([]);
  });

  it("skips URLs that are already short links", () => {
    const text = "Visit https://aihero.dev/s/abc123 for the link.";
    expect(findConvertibleAiHeroUrls(text)).toEqual([]);
  });

  it("deduplicates repeated URLs", () => {
    const text =
      "https://aihero.dev/skills/subscribe and https://aihero.dev/skills/subscribe again";
    expect(findConvertibleAiHeroUrls(text)).toEqual([
      "https://aihero.dev/skills/subscribe",
    ]);
  });

  it("returns multiple distinct URLs", () => {
    const text =
      "https://aihero.dev/skills/subscribe and https://aihero.dev/articles/intro";
    expect(findConvertibleAiHeroUrls(text)).toHaveLength(2);
  });

  it("finds URLs with www prefix", () => {
    const text = "Visit https://www.aihero.dev/skills/subscribe today.";
    expect(findConvertibleAiHeroUrls(text)).toEqual([
      "https://www.aihero.dev/skills/subscribe",
    ]);
  });

  it("skips www short links too", () => {
    const text = "Visit https://www.aihero.dev/s/abc123 today.";
    expect(findConvertibleAiHeroUrls(text)).toEqual([]);
  });

  it("handles URLs in parentheses", () => {
    const text = "(https://aihero.dev/skills/subscribe)";
    expect(findConvertibleAiHeroUrls(text)).toEqual([
      "https://aihero.dev/skills/subscribe",
    ]);
  });

  it("handles mixed short and long links", () => {
    const text =
      "https://aihero.dev/s/abc123 and https://aihero.dev/skills/subscribe";
    expect(findConvertibleAiHeroUrls(text)).toEqual([
      "https://aihero.dev/skills/subscribe",
    ]);
  });
});

describe("hasAiHeroUrls", () => {
  it("returns true when aihero.dev URL exists", () => {
    expect(hasAiHeroUrls("Visit https://aihero.dev/skills/subscribe")).toBe(
      true
    );
  });

  it("returns false when no aihero.dev URL exists", () => {
    expect(hasAiHeroUrls("No links here")).toBe(false);
  });

  it("returns true for short links too", () => {
    expect(hasAiHeroUrls("Visit https://aihero.dev/s/abc123")).toBe(true);
  });

  it("returns true for www variant", () => {
    expect(hasAiHeroUrls("Visit https://www.aihero.dev/page")).toBe(true);
  });
});

describe("replaceUrls", () => {
  it("replaces a single URL", () => {
    const text = "Visit https://aihero.dev/skills/subscribe for more.";
    const replacements = new Map([
      ["https://aihero.dev/skills/subscribe", "https://aihero.dev/s/abc"],
    ]);
    expect(replaceUrls(text, replacements)).toBe(
      "Visit https://aihero.dev/s/abc for more."
    );
  });

  it("replaces all occurrences of a URL", () => {
    const text =
      "https://aihero.dev/skills/subscribe and https://aihero.dev/skills/subscribe";
    const replacements = new Map([
      ["https://aihero.dev/skills/subscribe", "https://aihero.dev/s/abc"],
    ]);
    expect(replaceUrls(text, replacements)).toBe(
      "https://aihero.dev/s/abc and https://aihero.dev/s/abc"
    );
  });

  it("replaces multiple distinct URLs", () => {
    const text = "https://aihero.dev/a then https://aihero.dev/b";
    const replacements = new Map([
      ["https://aihero.dev/a", "https://aihero.dev/s/1"],
      ["https://aihero.dev/b", "https://aihero.dev/s/2"],
    ]);
    expect(replaceUrls(text, replacements)).toBe(
      "https://aihero.dev/s/1 then https://aihero.dev/s/2"
    );
  });

  it("returns text unchanged when replacements map is empty", () => {
    const text = "No changes here.";
    expect(replaceUrls(text, new Map())).toBe("No changes here.");
  });
});
