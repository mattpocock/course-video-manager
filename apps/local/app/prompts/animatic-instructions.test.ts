import { describe, it, expect } from "vitest";
import { getAnimaticSection } from "./animatic-instructions";

const ANIMATIC = 'Mockup 1: "Here is the trick."';

describe("getAnimaticSection", () => {
  it("returns empty string for no Animatic", () => {
    expect(getAnimaticSection("", "a transcript")).toBe("");
    expect(getAnimaticSection("  \n ", "")).toBe("");
  });

  it("ranks the Animatic below the transcript once the video is filmed", () => {
    const section = getAnimaticSection(ANIMATIC, "[0] Here is the trick.");
    expect(section).toContain(ANIMATIC);
    expect(section).toContain("the transcript confirms or overrules");
    expect(section).not.toContain("not been filmed");
  });

  it("lets the Animatic set the scope when there is no transcript", () => {
    const section = getAnimaticSection(ANIMATIC, "  ");
    expect(section).toContain(ANIMATIC);
    expect(section).toContain("not been filmed");
    expect(section).toContain("set the scope and the order");
    expect(section).toContain("ChooseScreenshot");
    expect(section).not.toContain("the transcript confirms or overrules");
  });
});
