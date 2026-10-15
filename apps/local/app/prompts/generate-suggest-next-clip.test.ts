import { describe, expect, it } from "vitest";
import { generateSuggestNextClipPrompt } from "./generate-suggest-next-clip";

describe("generateSuggestNextClipPrompt", () => {
  it("holds the sources it is given and the recent Clips, and nothing else", () => {
    const prompt = generateSuggestNextClipPrompt({
      animatic: 'Mockup 3: "ANIMATIC_MARKER"',
      recentClips: ["CLIP_MARKER"],
    });
    expect(prompt).toContain("ANIMATIC_MARKER");
    expect(prompt).toContain("Clip 1: CLIP_MARKER");
    expect(prompt).not.toContain("<script>");
    expect(prompt).not.toContain("<beats>");
  });

  it("asks for an opening line when nothing has been recorded", () => {
    const prompt = generateSuggestNextClipPrompt({
      script: "Welcome.",
      recentClips: [],
    });
    expect(prompt).toContain("opening line");
  });

  it("puts the Notes first, as overriding the plan", () => {
    const prompt = generateSuggestNextClipPrompt({
      notes: "NOTES_MARKER",
      script: "SCRIPT_MARKER",
      recentClips: [],
    });
    expect(prompt.indexOf("NOTES_MARKER")).toBeLessThan(
      prompt.indexOf("SCRIPT_MARKER")
    );
    expect(prompt).toContain("PRIORITY");
  });
});
