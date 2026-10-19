import { describe, expect, it } from "vitest";
import { asSchema } from "ai";
import {
  buildDocumentWritingSystemMessage,
  editDocumentTool,
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

  // The Animatic and its comments change between writing sessions, not
  // within one, so they ride inside the 1h breakpoint like the beats.
  it("includes the Animatic in the cached block", () => {
    const message = buildDocumentWritingSystemMessage(
      baseContext({ animatic: 'Mockup 1: "UNIQUE_ANIMATIC_MARKER"' })
    );

    expect(message.content).toContain("UNIQUE_ANIMATIC_MARKER");
    expect(message.providerOptions).toEqual(CACHE_BREAKPOINT_1H);
  });

  // The counterpart to the rule above: page fields churn (in the SEO writer
  // they are the entire lesson body), so they must never reach the system
  // prompt. The route sends them as a message behind the breakpoint instead.
  it("never contains the related page fields", () => {
    const message = buildDocumentWritingSystemMessage(baseContext());

    expect(message.content).not.toContain("Related Fields");
  });
});

describe("lesson role modes", () => {
  it("teaches an explainer to write a quiz", () => {
    const message = buildDocumentWritingSystemMessage(
      baseContext({ mode: "explainer" })
    );
    expect(message.content).toContain("<QuizQuestion");
  });

  it("never teaches a solution to write a quiz, and forbids one", () => {
    const message = buildDocumentWritingSystemMessage(
      baseContext({ mode: "solution" })
    );
    expect(message.content).not.toContain("<QuizQuestion");
    expect(message.content).toContain("Never write a quiz");
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

describe("editDocumentTool input", () => {
  // The SDK validates a tool call against this schema before the client ever
  // sees it; a failure goes back to the model as a tool error to retry. The
  // client folds whatever passes into the document, so anything that passes
  // must be an edit `applyEdits` can run. A `replace` with no `old_text` once
  // passed, and crashed the writer: "Cannot read properties of undefined
  // (reading 'split')".
  const validate = (input: unknown) =>
    asSchema(editDocumentTool.inputSchema).validate!(input);

  it.each([
    ["replace without old_text", { type: "replace", new_text: "Replaced" }],
    ["insert_after without anchor", { type: "insert_after", new_text: "More" }],
  ])("rejects %s", async (_, edit) => {
    const result = await validate({ edits: [{ ...edit, message: "fake" }] });
    expect(result.success).toBe(false);
  });

  it("accepts each edit type with the field it needs", async () => {
    const result = await validate({
      edits: [
        { type: "replace", old_text: "a", new_text: "b", message: "m" },
        { type: "insert_after", anchor: "b", new_text: "c", message: "m" },
        { type: "rewrite", new_text: "# Whole", message: "m" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
