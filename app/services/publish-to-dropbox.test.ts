import { describe, expect, it } from "vitest";
import { buildChapters } from "./publish-to-dropbox";

describe("buildChapters", () => {
  const clip = (order: string, duration: number) => ({
    order,
    sourceStartTime: 0,
    sourceEndTime: duration,
  });
  const section = (order: string, name: string) => ({ order, name });

  it("returns null when there are no chapters", () => {
    expect(buildChapters([clip("a0", 10)], [])).toBeNull();
  });

  it("returns null when every chapter is zero-length", () => {
    // Two sections back-to-back with no clips between them and nothing after.
    expect(
      buildChapters([clip("a0", 5)], [section("a1", "A"), section("a2", "B")])
    ).toBeNull();
  });

  it("computes startTime as the floored sum of preceding clip durations", () => {
    const result = buildChapters(
      [clip("a0", 22.4), clip("a2", 13.9), clip("a4", 44.2)],
      [section("a1", "Intro topic"), section("a3", "Next topic")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "Intro topic", startTime: 22 },
      { title: "Next topic", startTime: 36 },
    ]);
  });

  it("prepends a synthetic Intro chapter when the first chapter is not at 0", () => {
    const result = buildChapters(
      [clip("a0", 10), clip("a2", 10)],
      [section("a1", "Second segment")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "Second segment", startTime: 10 },
    ]);
  });

  it("does not prepend Intro when the first chapter already starts at 0", () => {
    const result = buildChapters(
      [clip("a1", 10), clip("a2", 5)],
      [section("a0", "Welcome")]
    );
    expect(result).toEqual([{ title: "Welcome", startTime: 0 }]);
  });

  it("drops zero-length chapters between non-empty ones", () => {
    // Section B has no clips before C → B is zero-length and dropped.
    const result = buildChapters(
      [clip("a1", 10), clip("a4", 5)],
      [section("a0", "A"), section("a2", "B"), section("a3", "C")]
    );
    expect(result).toEqual([
      { title: "A", startTime: 0 },
      { title: "C", startTime: 10 },
    ]);
  });

  it("drops a trailing zero-length chapter", () => {
    const result = buildChapters([clip("a0", 10)], [section("a1", "Trailing")]);
    expect(result).toBeNull();
  });
});
