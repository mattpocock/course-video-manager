import { describe, expect, it } from "vitest";
import { generateSuggestNextClipPrompt } from "./generate-suggest-next-clip";

describe("generateSuggestNextClipPrompt", () => {
  it("holds the sources it is given and nothing else", () => {
    const prompt = generateSuggestNextClipPrompt({
      animatic: 'Mockup 3: "ANIMATIC_MARKER"',
      clips: ["CLIP_MARKER"],
    });
    expect(prompt).toContain("ANIMATIC_MARKER");
    expect(prompt).toContain("Clip 1: CLIP_MARKER");
    expect(prompt).not.toContain("<script>");
    expect(prompt).not.toContain("<beats>");
  });

  it("numbers every Clip, and sets the last three apart as where the author is now", () => {
    const prompt = generateSuggestNextClipPrompt({
      clips: ["one", "two", "three", "four", "five"],
    });
    const earlier = prompt.slice(
      prompt.indexOf("<earlier-clips>"),
      prompt.indexOf("</earlier-clips>")
    );
    const recent = prompt.slice(
      prompt.indexOf("<most-recent-clips>"),
      prompt.indexOf("</most-recent-clips>")
    );
    expect(earlier).toContain("Clip 1: one\nClip 2: two");
    expect(recent).toContain("Clip 3: three\nClip 4: four\nClip 5: five");
    expect(prompt).toContain("RIGHT NOW");
  });

  it("asks for the important words in bold", () => {
    expect(generateSuggestNextClipPrompt({ clips: [] })).toContain(
      "**like this**"
    );
  });

  it("asks for an opening line when nothing has been recorded", () => {
    const prompt = generateSuggestNextClipPrompt({
      script: "Welcome.",
      clips: [],
    });
    expect(prompt).toContain("opening line");
  });

  it("puts the Notes first, as overriding the plan", () => {
    const prompt = generateSuggestNextClipPrompt({
      notes: "NOTES_MARKER",
      script: "SCRIPT_MARKER",
      clips: [],
    });
    expect(prompt.indexOf("NOTES_MARKER")).toBeLessThan(
      prompt.indexOf("SCRIPT_MARKER")
    );
    expect(prompt).toContain("PRIORITY");
  });
});
