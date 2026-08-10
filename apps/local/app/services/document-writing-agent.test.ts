import { describe, expect, it } from "vitest";
import {
  buildDocumentWritingSystemMessage,
  formatRelatedFields,
  type DocumentWritingContext,
} from "./document-writing-agent";
import { CACHE_BREAKPOINT_1H } from "./prompt-cache";

const baseContext = (
  overrides: Partial<DocumentWritingContext> = {}
): DocumentWritingContext => ({
  transcript: "[1] So today we are going to look at prompt caching.",
  code: [{ path: "writer-notes.md", content: "# Notes" }],
  imageFiles: [],
  ...overrides,
});

describe("buildDocumentWritingSystemMessage", () => {
  it("carries a one-hour cache breakpoint", () => {
    const message = buildDocumentWritingSystemMessage(baseContext());

    expect(message.role).toBe("system");
    expect(message.providerOptions).toEqual(CACHE_BREAKPOINT_1H);
    expect(message.providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  // The whole scheme rests on this. The prompt used to branch on whether a
  // document existed, so the first draft landing rewrote the system block and
  // threw away the transcript, code files and screenshots with it — once per
  // document, silently. The model must discriminate on the message instead.
  it("describes both tools and discriminates on <current-document>", () => {
    const message = buildDocumentWritingSystemMessage(baseContext());

    expect(message.content).toContain("writeDocument");
    expect(message.content).toContain("editDocument");
    expect(message.content).toContain("<current-document>");
  });

  it("puts the transcript ahead of the code files", () => {
    const message = buildDocumentWritingSystemMessage(
      baseContext({
        transcript: "UNIQUE_TRANSCRIPT_MARKER",
        code: [{ path: "notes.md", content: "UNIQUE_CODE_MARKER" }],
      })
    );

    const transcriptAt = message.content.indexOf("UNIQUE_TRANSCRIPT_MARKER");
    const codeAt = message.content.indexOf("UNIQUE_CODE_MARKER");

    expect(transcriptAt).toBeGreaterThanOrEqual(0);
    expect(codeAt).toBeGreaterThan(transcriptAt);
  });

  // Memory changes rarely — less than once an hour — so it belongs inside the
  // cached block rather than costing a breakpoint of its own.
  it("includes memory in the cached block", () => {
    const message = buildDocumentWritingSystemMessage(
      baseContext({ memory: "UNIQUE_MEMORY_MARKER" })
    );

    expect(message.content).toContain("UNIQUE_MEMORY_MARKER");
  });

  // The counterpart to the rule above: page fields churn (in the SEO writer
  // they are the entire lesson body), so they must never reach the system
  // prompt. The route sends them as a message behind the breakpoint instead.
  it("never contains the related page fields", () => {
    const message = buildDocumentWritingSystemMessage(baseContext());

    expect(message.content).not.toContain("Related Fields");
  });
});

describe("formatRelatedFields", () => {
  it("returns undefined when there is nothing to send", () => {
    expect(formatRelatedFields([])).toBeUndefined();
    expect(
      formatRelatedFields([{ label: "SEO", value: "   " }])
    ).toBeUndefined();
  });

  it("renders populated fields and drops empty ones", () => {
    const result = formatRelatedFields([
      { label: "SEO Description", value: "A lesson about caching." },
      { label: "Empty Field", value: "" },
    ]);

    expect(result).toContain("SEO Description");
    expect(result).toContain("A lesson about caching.");
    expect(result).not.toContain("Empty Field");
  });
});
