import { describe, expect, it } from "vitest";
import {
  generateShortTitlePrompt,
  generateShortDescriptionPrompt,
} from "./generate-short-title-description";

describe("generateShortTitlePrompt", () => {
  it("includes the transcript in the prompt", () => {
    const prompt = generateShortTitlePrompt({
      transcript: "Today we will learn about TypeScript generics.",
    });

    expect(prompt).toContain("TypeScript generics");
    expect(prompt).toContain("<transcript>");
  });

  it("instructs for a short working title", () => {
    const prompt = generateShortTitlePrompt({
      transcript: "Some transcript.",
    });

    expect(prompt).toContain("3-8 words");
    expect(prompt).toContain("ONLY the title text");
  });
});

describe("generateShortDescriptionPrompt", () => {
  it("includes the transcript in the prompt", () => {
    const prompt = generateShortDescriptionPrompt({
      transcript: "This is about React hooks and their lifecycle.",
    });

    expect(prompt).toContain("React hooks");
    expect(prompt).toContain("<transcript>");
  });

  it("asks for a factual summary", () => {
    const prompt = generateShortDescriptionPrompt({
      transcript: "Some transcript.",
    });

    expect(prompt).toContain("1-2 sentence");
    expect(prompt).toContain("ONLY the description text");
  });
});
