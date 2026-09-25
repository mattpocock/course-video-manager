import { describe, expect, it } from "vitest";
import { DEFAULT_BANNED_PHRASES } from "@/features/article-writer/lint-rules";
import { parseBannedPhrases } from "./use-banned-phrases";

const PHRASE = {
  pattern: "delve",
  readable: "delve",
  caseSensitive: false,
};

describe("parseBannedPhrases", () => {
  it("reads back a stored phrase list", () => {
    expect(parseBannedPhrases(JSON.stringify([PHRASE]))).toEqual([PHRASE]);
  });

  it("keeps an emptied list empty rather than resurrecting the defaults", () => {
    expect(parseBannedPhrases("[]")).toEqual([]);
  });

  it("falls back to the defaults on unparseable JSON", () => {
    expect(parseBannedPhrases("not json")).toEqual(DEFAULT_BANNED_PHRASES);
  });

  it("falls back to the defaults when the value is not an array", () => {
    expect(parseBannedPhrases('{"pattern":"delve"}')).toEqual(
      DEFAULT_BANNED_PHRASES
    );
  });

  it("drops malformed members rather than the whole list", () => {
    expect(
      parseBannedPhrases(
        JSON.stringify([PHRASE, null, 7, { pattern: "no readable" }])
      )
    ).toEqual([PHRASE]);
  });
});
