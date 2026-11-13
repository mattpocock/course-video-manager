import { describe, expect, it } from "vitest";
import { Output, streamText } from "ai";
import {
  createFakeWriterModel,
  FAKE_SUGGESTION,
} from "@/services/fake-writer-model";
import {
  generateSuggestNextClipPrompt,
  generateSuggestNextClipPromptParts,
  MAX_DIAGRAM_TEXT_CHARS,
  MAX_PREVIOUS_VIDEO_CHARS,
  MAX_REPO_FILES_CHARS,
  readSuggestionLines,
  suggestionsLineStream,
  suggestionsSchema,
} from "./generate-suggest-next-clip";

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

  it("puts the Steer with the Clips, outside the cached plan, as outranking the plan, and asks for one line", () => {
    const { plan, now } = generateSuggestNextClipPromptParts({
      steer: "STEER_MARKER",
      script: "SCRIPT_MARKER",
      clips: ["CLIP_MARKER"],
    });
    expect(plan).not.toContain("STEER_MARKER");
    expect(now.indexOf("CLIP_MARKER")).toBeLessThan(
      now.indexOf("STEER_MARKER")
    );
    expect(now).toContain("PRIORITY");
    expect(now).not.toMatch(/different paths|title/i);
    expect(generateSuggestNextClipPrompt({ clips: [] })).not.toContain(
      "<steer>"
    );
  });

  it("puts the picked repo files in the cached plan, above the Script", () => {
    const { plan, now } = generateSuggestNextClipPromptParts({
      script: "SCRIPT_MARKER",
      files: [{ path: "src/index.ts", content: "FILE_MARKER" }],
      clips: ["CLIP_MARKER"],
    });
    expect(plan).toContain('<file path="src/index.ts">\nFILE_MARKER\n</file>');
    expect(now).not.toContain("FILE_MARKER");
    expect(plan.indexOf("FILE_MARKER")).toBeLessThan(
      plan.indexOf("SCRIPT_MARKER")
    );
  });

  it("puts the on-screen Diagram's text with the Clips, not the cached plan, cut short past the limit", () => {
    const { plan, now } = generateSuggestNextClipPromptParts({
      diagram: `DIAGRAM_MARKER ${"x".repeat(MAX_DIAGRAM_TEXT_CHARS)}`,
      clips: ["CLIP_MARKER"],
    });
    expect(plan).not.toContain("DIAGRAM_MARKER");
    expect(now).toContain("<diagram-on-screen>\nDIAGRAM_MARKER");
    expect(now).toContain("[… cut: over the diagram text limit]");
    expect(now.indexOf("CLIP_MARKER")).toBeLessThan(
      now.indexOf("DIAGRAM_MARKER")
    );
  });

  it("gives the on-screen Diagram as a diff against the last Clip's DiagramSnapshot, every line kept", () => {
    const { now } = generateSuggestNextClipPromptParts({
      lastClipDiagram: "Client\nServer\nDatabase",
      diagram: "Client\nAPI Gateway\nServer",
      clips: ["CLIP_MARKER"],
    });
    expect(now).toContain(
      "<diagram-changes-since-last-clip>\n Client\n+API Gateway\n Server\n-Database\n</diagram-changes-since-last-clip>"
    );
    expect(now).toContain("+ was added since the last clip");
    expect(now).not.toContain("<diagram-on-screen>");
  });

  it("gives the Diagram flattened, as one line, when there is nothing to diff against or nothing changed", () => {
    const plain = generateSuggestNextClipPromptParts({
      diagram: "Client\nServer",
      clips: [],
    }).now;
    expect(plain).toContain("<diagram-on-screen>\nClient Server\n");
    expect(plain).not.toContain("unchanged since the last clip");

    const unchanged = generateSuggestNextClipPromptParts({
      lastClipDiagram: "Client\nServer",
      diagram: "Client\nServer",
      clips: [],
    }).now;
    expect(unchanged).toContain("<diagram-on-screen>\nClient Server\n");
    expect(unchanged).toContain("unchanged since the last clip");
  });

  it("puts the previous Video's Clips last in the cached plan, keeping their end past the limit", () => {
    const { plan, now } = generateSuggestNextClipPromptParts({
      script: "SCRIPT_MARKER",
      previousVideo: `EARLY_MARKER${"x".repeat(MAX_PREVIOUS_VIDEO_CHARS)}LATE_MARKER`,
      clips: ["CLIP_MARKER"],
    });
    expect(now).not.toContain("LATE_MARKER");
    expect(plan).not.toContain("EARLY_MARKER");
    expect(plan).toContain("[… cut: earlier clips over the limit]");
    expect(plan).toMatch(/LATE_MARKER\n<\/previous-video-clips>$/);
    expect(plan.indexOf("SCRIPT_MARKER")).toBeLessThan(
      plan.indexOf("<previous-video-clips>")
    );
  });

  it("cuts the repo files short past the limit, still naming every file", () => {
    const prompt = generateSuggestNextClipPrompt({
      files: [
        { path: "big.json", content: "x".repeat(MAX_REPO_FILES_CHARS + 10) },
        { path: "after.ts", content: "AFTER_MARKER" },
      ],
      clips: [],
    });
    expect(prompt).toContain("cut: over the repo files limit");
    expect(prompt).toContain('<file path="after.ts">');
    expect(prompt).not.toContain("AFTER_MARKER");
    expect(prompt).not.toContain("x".repeat(MAX_REPO_FILES_CHARS + 1));
  });
});

describe("suggestionsLineStream", () => {
  it("streams the one Suggestion from the model's answer, as it is written, and nothing else", async () => {
    const calls: Parameters<
      ReturnType<typeof createFakeWriterModel>["doStream"]
    >[0][] = [];
    const result = streamText({
      model: createFakeWriterModel({ calls }),
      output: Output.object({ schema: suggestionsSchema }),
      prompt: "What do I say next?",
    });

    let received = "";
    const seen: (string | null)[] = [];
    for await (const chunk of suggestionsLineStream(
      result.partialOutputStream
    )) {
      received += chunk;
      seen.push(readSuggestionLines(received));
    }

    // The editor reads the Suggestion's text, and no JSON keys.
    expect(readSuggestionLines(received)).toBe(FAKE_SUGGESTION);
    // Still streams: some of it shows before the rest arrives.
    expect(
      seen.some((s) => s !== null && s.length < FAKE_SUGGESTION.length)
    ).toBe(true);
    expect(calls[0]!.responseFormat).toMatchObject({ type: "json" });
  });

  it("skips a torn line, and reads nothing before the first", () => {
    expect(readSuggestionLines('"Half')).toBeNull();
    expect(readSuggestionLines('"One"\n"Two\n')).toBe("One");
  });
});
