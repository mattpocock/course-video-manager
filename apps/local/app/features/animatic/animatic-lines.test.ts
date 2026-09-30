import { describe, expect, it } from "vitest";
import { buildAnimaticLines } from "./animatic-lines";

const mockup = (id: string, order: string) => ({
  id,
  line: `Line ${id}.`,
  order,
});

const chapter = (id: string, name: string, order: string) => ({
  id,
  name,
  order,
});

describe("buildAnimaticLines", () => {
  it("merges both nouns into one list by their shared order", () => {
    const lines = buildAnimaticLines({
      clipMockups: [mockup("b", "a2"), mockup("a", "a0"), mockup("c", "a4")],
      chapters: [chapter("ch2", "Second", "a3"), chapter("ch1", "First", "a1")],
      comments: [],
    });

    expect(lines).toEqual([
      {
        type: "clip-mockup",
        id: "a",
        line: "Line a.",
        comments: [],
        position: 1,
      },
      { type: "chapter", id: "ch1", name: "First", comments: [] },
      {
        type: "clip-mockup",
        id: "b",
        line: "Line b.",
        comments: [],
        position: 2,
      },
      { type: "chapter", id: "ch2", name: "Second", comments: [] },
      {
        type: "clip-mockup",
        id: "c",
        line: "Line c.",
        comments: [],
        position: 3,
      },
    ]);
  });

  it("numbers Clip Mockups only, so a Chapter never shifts a position", () => {
    const lines = buildAnimaticLines({
      clipMockups: [mockup("a", "a1"), mockup("b", "a3")],
      chapters: [chapter("ch", "Only", "a0"), chapter("empty", "Empty", "a2")],
      comments: [],
    });

    expect(
      lines.flatMap((l) => (l.type === "clip-mockup" ? [l.position] : []))
    ).toEqual([1, 2]);
  });

  it("sorts byte-wise, not by locale", () => {
    // Uppercase sorts before lowercase in "C" collation; a locale sort
    // would put "a" first.
    const lines = buildAnimaticLines({
      clipMockups: [mockup("lower", "a"), mockup("upper", "Z")],
      chapters: [],
      comments: [],
    });

    expect(lines.map((l) => l.id)).toEqual(["upper", "lower"]);
  });

  it("is empty for Chapters with no Clip Mockup, so the tab hides", () => {
    expect(
      buildAnimaticLines({
        clipMockups: [],
        chapters: [chapter("ch", "Empty", "a0")],
        comments: [],
      })
    ).toEqual([]);
  });

  it("hangs each comment under its own Clip Mockup or Chapter, in order", () => {
    const lines = buildAnimaticLines({
      clipMockups: [mockup("a", "a1"), mockup("b", "a2")],
      chapters: [chapter("ch", "Setup", "a0")],
      comments: [
        { clipMockupId: "b", clipMockupChapterId: null, body: "first on b" },
        { clipMockupId: null, clipMockupChapterId: "ch", body: "on setup" },
        { clipMockupId: "b", clipMockupChapterId: null, body: "second on b" },
      ],
    });

    expect(lines.map((l) => [l.id, l.comments])).toEqual([
      ["ch", ["on setup"]],
      ["a", []],
      ["b", ["first on b", "second on b"]],
    ]);
  });
});
