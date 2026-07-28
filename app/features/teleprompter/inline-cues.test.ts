import { describe, expect, it } from "vitest";
import { splitInlineCues } from "./inline-cues";

const prose = (text: string) => ({ cue: false, value: text });
const cue = (text: string) => ({ cue: true, value: text });

describe("splitInlineCues", () => {
  it("leaves text with no brackets alone", () => {
    expect(splitInlineCues("So what is a monad?")).toEqual([
      prose("So what is a monad?"),
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(splitInlineCues("")).toEqual([]);
  });

  it("splits a cue out of the middle of a line", () => {
    expect(
      splitInlineCues("Open the file [scroll to line 40] and look.")
    ).toEqual([
      prose("Open the file "),
      cue("[scroll to line 40]"),
      prose(" and look."),
    ]);
  });

  it("keeps the brackets on the cue", () => {
    expect(splitInlineCues("[wave at the camera]")).toEqual([
      cue("[wave at the camera]"),
    ]);
  });

  it("finds every cue on a line", () => {
    expect(splitInlineCues("[pause] then [point] then go")).toEqual([
      cue("[pause]"),
      prose(" then "),
      cue("[point]"),
      prose(" then go"),
    ]);
  });

  it("is not fooled by an unresolved image, which is not a cue", () => {
    expect(splitInlineCues("![the diagram]")).toEqual([
      prose("![the diagram]"),
    ]);
  });

  it("treats a cue spanning several lines as one cue", () => {
    expect(splitInlineCues("[improvise here,\nthen recap]")).toEqual([
      cue("[improvise here,\nthen recap]"),
    ]);
  });

  it("does not run a cue across a closing bracket", () => {
    expect(splitInlineCues("[one] [two]")).toEqual([
      cue("[one]"),
      prose(" "),
      cue("[two]"),
    ]);
  });
});
